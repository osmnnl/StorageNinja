// StorageNinja 2 - UI for the popup (popup.html) and the DevTools panel / full tab (panel.html).
// All page and chrome.* work happens in the service worker; this file only renders and sends ops.

import { tokenMeta, describeSource, stripBearer, decodeJwt, sameSource } from '../core/token.js';
import { icon } from './icons.js';

const params = new URLSearchParams(location.search);
const IS_POPUP = document.body.classList.contains('mode-popup');
const VERSION = chrome.runtime.getManifest().version;

const STORES = [
    { type: 'localStorage', label: 'Local Storage', tab: 'Local', dot: 'var(--dot-local)', paste: true },
    { type: 'sessionStorage', label: 'Session Storage', tab: 'Session', dot: 'var(--dot-session)', paste: true },
    { type: 'cookies', label: 'Cookies', tab: 'Cookies', dot: 'var(--dot-cookies)', paste: true },
    { type: 'indexedDB', label: 'IndexedDB', tab: 'IndexedDB', dot: 'var(--dot-idb)', paste: false, unit: ' db' },
    { type: 'cacheStorage', label: 'Cache Storage', tab: 'Cache', dot: 'var(--dot-cache)', paste: false }
];
const storeDef = type => STORES.find(s => s.type === type);

const state = {
    tabId: null,
    summary: null,
    view: 'main',
    theme: 'system',
    tokenMenuOpen: false,
    snapshotFormOpen: false,
    // details view
    type: 'localStorage',
    frameId: 0,
    frames: [],
    data: null,
    filter: '',
    selected: null,
    editor: null,
    jwtView: 'decoded'
};

const app = document.getElementById('app');

// ---- Helpers ----------------------------------------------------------------------------------

function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

function iconButton(name, label, onClick, cls = '', disabled = false) {
    return h('button', { class: `icon-btn ${cls}`, 'aria-label': label, title: label, onClick, disabled }, icon(name));
}

async function call(op, args = {}) {
    const res = await chrome.runtime.sendMessage({ op, tabId: state.tabId, ...args });
    if (!res) throw new Error('No response from StorageNinja');
    if (!res.ok) throw new Error(res.error);
    return res.data;
}

let toastTimer = null;
function toast(text, kind = 'success') {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.className = `toast ${kind} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function guard(fn) {
    try {
        return await fn();
    } catch (e) {
        toast(e.message || String(e), 'error');
        return undefined;
    }
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        await call('clipboard.write', { text });
    }
}

async function readText() {
    try {
        return await navigator.clipboard.readText();
    } catch (_) {
        return call('clipboard.read');
    }
}

function modal({ title, body, actions }) {
    return new Promise(resolve => {
        const close = value => {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
            resolve(value);
        };
        const onKey = e => {
            if (e.key === 'Escape') close(null);
        };
        const overlay = h('div', { class: 'modal-overlay', onClick: e => e.target === overlay && close(null) },
            h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
                h('h2', { text: title }),
                typeof body === 'string' ? h('p', { text: body }) : body,
                h('div', { class: 'modal-actions' },
                    h('button', { class: 'btn', onClick: () => close(null) }, 'Cancel'),
                    actions.map(a => h('button', { class: `btn ${a.kind || ''}`, onClick: () => close(a.value) }, a.label)))));
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);
        const buttons = overlay.querySelectorAll('.modal-actions button');
        buttons[buttons.length - 1].focus();
    });
}

function confirmDanger(title, body, label = 'Delete') {
    return modal({ title, body, actions: [{ label, value: true, kind: 'danger' }] });
}

function askPasteMode(label, count) {
    return modal({
        title: `Paste into ${label}`,
        body: `${count} item${count === 1 ? '' : 's'} found in the clipboard. Merge keeps existing data and overwrites matching keys. Replace deletes everything first.`,
        actions: [
            { label: 'Replace', value: 'replace', kind: 'danger' },
            { label: 'Merge', value: 'merge', kind: 'primary' }
        ]
    });
}

function countOf(data) {
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') {
        if (data.$storageNinja) return null;
        return Object.keys(data).length;
    }
    return 0;
}

function parseJson(text) {
    if (!text || !text.trim()) throw new Error('Clipboard is empty');
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error('Clipboard does not contain valid JSON');
    }
}

function formatDuration(sec) {
    const abs = Math.abs(sec);
    if (abs < 90) return `${abs} s`;
    if (abs < 5400) return `${Math.round(abs / 60)} min`;
    if (abs < 172800) return `${Math.round(abs / 3600)} h`;
    return `${Math.round(abs / 86400)} days`;
}

function formatDate(ms) {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function valueType(v) {
    if (typeof v !== 'string') return 'json';
    const s = v.trim();
    if (decodeJwt(s)) return 'jwt';
    if ((s.startsWith('{') || s.startsWith('[')) && s.length > 1) {
        try {
            JSON.parse(s);
            return 'json';
        } catch (_) { /* text */ }
    }
    if (s !== '' && !isNaN(Number(s))) return 'number';
    if (s === 'true' || s === 'false') return 'bool';
    return 'text';
}

function typeChip(t) {
    const cls = t === 'jwt' ? 'jwt' : t === 'json' ? 'json' : '';
    return h('span', { class: `chip ${cls}` }, t === 'jwt' ? 'JWT' : t === 'json' ? 'JSON' : t);
}

function jwtChip(meta) {
    if (!meta.jwt) return h('span', { class: 'chip' }, 'Opaque token');
    if (meta.expired) return h('span', { class: 'chip warn' }, `JWT · expired ${formatDuration(meta.expiresInSec)} ago`);
    if (meta.exp) return h('span', { class: 'chip ok' }, `JWT · ${formatDuration(meta.expiresInSec)} left`);
    return h('span', { class: 'chip jwt' }, 'JWT');
}

function downloadJson(data, name) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ---- Theme ------------------------------------------------------------------------------------

function effectiveTheme() {
    if (state.theme === 'light' || state.theme === 'dark') return state.theme;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
    if (state.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = state.theme;
}

async function toggleTheme() {
    state.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme();
    render();
    await guard(() => call('settings.set', { patch: { theme: state.theme } }));
}

// ---- Shared operations ------------------------------------------------------------------------

async function loadSummary() {
    state.summary = await call('summary');
}

async function copyStorage(type) {
    await guard(async () => {
        const data = await call('storage.get', { type, frameId: state.view === 'details' ? state.frameId : 0 });
        await copyText(JSON.stringify(data, null, 2));
        const n = countOf(data);
        toast(`${storeDef(type).label} copied${n === null ? '' : ` (${n} items)`}`);
    });
}

async function pasteStorage(type, forcedMode, text) {
    await guard(async () => {
        const data = parseJson(text ?? await readText());
        const part = data && data.$storageNinja ? data[type] : data;
        const n = countOf(part);
        const mode = forcedMode || await askPasteMode(storeDef(type).label, n ?? 0);
        if (!mode) return;
        const r = await call('storage.paste', { type, data, mode, frameId: state.view === 'details' ? state.frameId : 0 });
        let msg = `${r.count} item${r.count === 1 ? '' : 's'} pasted (${mode})`;
        if (r.moved) msg += `, ${r.moved} moved to ${state.summary.info.host}`;
        if (r.skipped) msg += `, ${r.skipped} expired skipped`;
        toast(msg, r.errors && r.errors.length ? 'info' : 'success');
        await refresh();
    });
}

async function clearStorage(type) {
    const label = storeDef(type).label;
    if (!(await confirmDanger(`Clear ${label}?`, `All ${label} data of ${state.summary.info.host} will be deleted.`, 'Clear'))) return;
    await guard(async () => {
        await call('storage.clear', { type, frameId: state.view === 'details' ? state.frameId : 0 });
        toast(`${label} cleared`);
        await refresh();
    });
}

async function refresh() {
    await guard(loadSummary);
    if (state.view === 'details') await guard(loadDetails);
    render();
}

function render() {
    document.body.classList.toggle('view-main', state.view === 'main');
    document.body.classList.toggle('view-details', state.view === 'details');
    app.replaceChildren(state.view === 'details' ? renderDetails() : renderMain());
}

// ---- Main view --------------------------------------------------------------------------------

function renderHeader() {
    const info = state.summary && state.summary.info;
    return h('div', { class: 'row' },
        h('div', { class: 'logo', 'aria-hidden': 'true' }, 'SN'),
        h('div', { class: 'grow' },
            h('div', { class: 'title' }, 'Storage ', h('span', {}, 'Ninja')),
            h('div', { class: 'muted small ellipsis', title: info ? info.url : '' }, info ? (info.host || 'Unsupported page') : 'Loading…')),
        h('button', { class: 'icon-btn square', 'aria-label': 'Refresh', title: 'Refresh', onClick: refresh }, icon('refresh', 16)),
        h('button', { class: 'icon-btn square', 'aria-label': 'Toggle theme', title: 'Toggle theme', onClick: toggleTheme },
            icon(effectiveTheme() === 'dark' ? 'sun' : 'moon', 16)));
}

function renderTokenCard() {
    const token = state.summary.token || { candidates: [] };
    const sel = token.selected;
    if (!sel) {
        return h('div', { class: 'token-card' },
            h('div', { class: 'row' }, icon('key'), h('span', { class: 'label' }, 'ACCESS TOKEN')),
            h('div', { class: 'muted small' }, 'No access token found on this page. JWTs and keys like access_token, id_token or token are detected in Local Storage, Session Storage and cookies.'));
    }
    const meta = tokenMeta(sel.token);
    const value = stripBearer(sel.token);
    const card = h('div', { class: 'token-card' },
        h('div', { class: 'row' },
            icon('key'),
            h('span', { class: 'label' }, 'ACCESS TOKEN'),
            h('span', { class: 'grow' }),
            jwtChip(meta)),
        h('div', { class: 'token-value mono ellipsis', title: value }, value),
        meta.subject ? h('div', { class: 'muted small ellipsis' }, `Subject: ${meta.subject}`) : null,
        h('div', { class: 'row muted small' },
            h('span', {}, token.pinned ? 'Pinned:' : 'Source:'),
            h('button', {
                class: 'link-btn grow', 'aria-haspopup': 'listbox', 'aria-expanded': String(state.tokenMenuOpen),
                title: 'Choose which value is the access token',
                onClick: () => {
                    state.tokenMenuOpen = !state.tokenMenuOpen;
                    render();
                }
            }, h('span', {}, describeSource(sel)), icon('chevronDown', 12))),
        h('div', { class: 'row' },
            h('button', {
                class: 'btn primary tall grow',
                onClick: () => guard(async () => {
                    await copyText(value);
                    toast('Access token copied');
                })
            }, icon('copy'), 'Copy token'),
            h('button', {
                class: 'btn tall',
                onClick: () => guard(async () => {
                    await copyText(`Bearer ${value}`);
                    toast('Copied as Bearer');
                })
            }, 'Copy as Bearer')));
    if (state.tokenMenuOpen) card.append(renderTokenMenu(token));
    return card;
}

function renderTokenMenu(token) {
    const choose = pin => guard(async () => {
        state.summary.token = await call('token.pin', { pin });
        state.tokenMenuOpen = false;
        render();
        toast(pin ? 'Token source pinned for this site' : 'Automatic detection restored', 'info');
    });
    return h('div', { class: 'dropdown', role: 'listbox' },
        token.pinned ? h('button', { onClick: () => choose(null) }, h('span', { class: 'key' }, 'Detect automatically'), h('span', { class: 'muted xsmall' }, 'Remove the pinned source for this site')) : null,
        token.candidates.map(c => {
            const meta = tokenMeta(c.token);
            return h('button', {
                class: sameSource(c, token.selected) ? 'active' : '',
                role: 'option',
                onClick: () => choose({ source: c.source, key: c.key, path: c.path })
            },
            h('span', { class: 'row' }, h('span', { class: 'small key ellipsis grow' }, describeSource(c)), jwtChip(meta)),
            h('span', { class: 'mono xsmall muted ellipsis' }, stripBearer(c.token)));
        }));
}

function renderStoreRows() {
    const counts = state.summary.counts || {};
    return h('div', { class: 'store-list' },
        h('div', { class: 'section-label' }, 'Storage'),
        STORES.map(s => {
            const n = counts[s.type];
            return h('div', { class: 'card store-row' },
                h('span', { class: 'dot', style: `background:${s.dot}` }),
                h('span', { class: 'store-name' }, s.label),
                h('span', { class: 'store-count' }, n === null || n === undefined ? '–' : `${n}${s.unit || ''}`),
                h('div', { class: 'actions' },
                    iconButton('copy', `Copy ${s.label} as JSON`, () => copyStorage(s.type), 'copy'),
                    iconButton('paste', s.paste ? `Paste into ${s.label}` : 'Paste is not available here', () => pasteStorage(s.type), 'paste', !s.paste),
                    iconButton('trash', `Clear ${s.label}`, () => clearStorage(s.type), 'clear'),
                    iconButton('chevronRight', `${s.label} details`, () => openDetails(s.type), 'details')));
        }));
}

function defaultSnapshotName() {
    return `Snapshot ${formatDate(Date.now())}`;
}

function renderSnapshots() {
    const snaps = state.summary.snapshots || [];
    let head;
    if (state.snapshotFormOpen) {
        const input = h('input', { class: 'input grow', 'aria-label': 'Snapshot name', value: defaultSnapshotName(), maxlength: '80' });
        const save = () => guard(async () => {
            await call('snapshot.save', { name: input.value.trim() || defaultSnapshotName() });
            state.snapshotFormOpen = false;
            toast('Snapshot saved');
            await refresh();
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
                state.snapshotFormOpen = false;
                render();
            }
        });
        head = h('div', { class: 'row' }, input,
            h('button', { class: 'btn small primary', onClick: save }, 'Save'),
            h('button', {
                class: 'btn small',
                onClick: () => {
                    state.snapshotFormOpen = false;
                    render();
                }
            }, 'Cancel'));
        setTimeout(() => input.select(), 0);
    } else {
        head = h('div', { class: 'row' },
            h('span', { class: 'section-label grow' }, 'Snapshots · this site'),
            h('button', {
                class: 'btn small',
                onClick: () => {
                    state.snapshotFormOpen = true;
                    render();
                }
            }, icon('camera', 12), 'Save current'));
    }
    return h('div', { class: 'store-list' },
        head,
        snaps.length
            ? h('div', { class: 'snap-list' }, snaps.map(s => h('div', { class: 'card snap-row' },
                h('div', { class: 'grow' },
                    h('div', { class: 'key ellipsis', title: s.name }, s.name),
                    h('div', { class: 'muted xsmall ellipsis' }, `${formatDate(s.createdAt)} · LS ${s.counts.localStorage} · SS ${s.counts.sessionStorage} · ${s.counts.cookies} cookies`)),
                h('button', { class: 'btn small restore', onClick: () => restoreSnapshot(s) }, 'Restore'),
                iconButton('edit', `Rename ${s.name}`, () => renameSnapshot(s)),
                iconButton('close', `Delete ${s.name}`, () => deleteSnapshot(s)))))
            : h('div', { class: 'card empty' }, 'No snapshots yet. Save the current state to switch back to it later, e.g. between test users.'));
}

async function restoreSnapshot(s) {
    const ok = await modal({
        title: `Restore “${s.name}”?`,
        body: 'Local Storage, Session Storage and cookies of this site will be replaced with the snapshot, then the page reloads.',
        actions: [{ label: 'Restore', value: true, kind: 'primary' }]
    });
    if (!ok) return;
    await guard(async () => {
        const r = await call('snapshot.restore', { id: s.id });
        toast(`Snapshot restored (${r.cookies.count} cookies)`);
        if (IS_POPUP) setTimeout(() => window.close(), 700);
        else setTimeout(refresh, 900);
    });
}

async function renameSnapshot(s) {
    const input = h('input', { class: 'input', 'aria-label': 'Snapshot name', value: s.name, maxlength: '80' });
    const ok = await modal({ title: 'Rename snapshot', body: input, actions: [{ label: 'Save', value: true, kind: 'primary' }] });
    if (!ok || !input.value.trim()) return;
    await guard(async () => {
        await call('snapshot.rename', { id: s.id, name: input.value.trim() });
        await refresh();
    });
}

async function deleteSnapshot(s) {
    if (!(await confirmDanger(`Delete “${s.name}”?`, 'The snapshot is removed from StorageNinja. The page is not changed.'))) return;
    await guard(async () => {
        await call('snapshot.delete', { id: s.id });
        await refresh();
    });
}

async function clearAllAndReload() {
    const ok = await confirmDanger('Clear everything and reload?',
        `Local Storage, Session Storage, Cookies, IndexedDB, Cache Storage and service workers of ${state.summary.info.host} will be deleted and the page reloads.`,
        'Clear & reload');
    if (!ok) return;
    await guard(async () => {
        await call('all.clearAndReload');
        toast('Cleared, reloading…');
        if (IS_POPUP) setTimeout(() => window.close(), 700);
        else setTimeout(refresh, 1200);
    });
}

function renderMain() {
    const root = h('div', { class: 'main' }, renderHeader());
    if (!state.summary) {
        root.append(h('div', { class: 'notice' }, 'Loading…'));
        return root;
    }
    if (!state.summary.info.supported) {
        root.append(h('div', { class: 'card notice' }, 'StorageNinja cannot access this page. Browser pages (chrome://, new tab, extensions) and the Chrome Web Store are protected by Chrome.'));
        return root;
    }
    root.append(
        renderTokenCard(),
        renderStoreRows(),
        renderSnapshots(),
        h('div', { class: 'row' },
            h('button', { class: 'btn danger tall grow', onClick: clearAllAndReload }, icon('refresh'), 'Clear all & reload'),
            h('span', { class: 'muted xsmall', title: 'Keyboard shortcuts (change at chrome://extensions/shortcuts)' }, 'Alt+Shift+S · v' + VERSION)));
    return root;
}

// ---- Details view -----------------------------------------------------------------------------

async function openDetails(type) {
    state.view = 'details';
    state.type = type;
    state.filter = '';
    state.selected = null;
    state.editor = null;
    state.data = null;
    render();
    await guard(async () => {
        if (!state.frames.length) state.frames = await call('frames.list');
        await loadDetails();
    });
    render();
}

function backToMain() {
    state.view = 'main';
    state.selected = null;
    state.editor = null;
    refresh();
}

async function loadDetails() {
    const t = state.type;
    const frameId = state.frameId;
    if (t === 'localStorage' || t === 'sessionStorage') state.data = await call('web.get', { type: t, frameId });
    else if (t === 'cookies') state.data = await call('cookies.list');
    else if (t === 'indexedDB') state.data = await call('idb.list', { frameId });
    else if (t === 'cacheStorage') state.data = await call('cache.list', { frameId });
}

function matches(...values) {
    const f = state.filter.trim().toLowerCase();
    if (!f) return true;
    return values.some(v => String(v ?? '').toLowerCase().includes(f));
}

function renderDetailsHeader() {
    const counts = (state.summary && state.summary.counts) || {};
    return h('div', { class: 'row' },
        iconButton('chevronLeft', 'Back', backToMain, 'square'),
        h('div', { class: 'tabs', role: 'tablist' }, STORES.map(s => h('button', {
            role: 'tab',
            'aria-selected': String(s.type === state.type),
            class: s.type === state.type ? 'active' : '',
            onClick: () => openDetails(s.type)
        }, `${s.tab}${counts[s.type] === null || counts[s.type] === undefined ? '' : ` (${counts[s.type]})`}`))),
        h('span', { class: 'grow muted small ellipsis', style: 'text-align:right', title: state.summary ? state.summary.info.url : '' }, state.summary ? state.summary.info.host : ''),
        iconButton('refresh', 'Refresh', refresh, 'square'),
        IS_POPUP ? iconButton('expand', 'Open in a tab', openInTab, 'square') : null,
        iconButton(effectiveTheme() === 'dark' ? 'sun' : 'moon', 'Toggle theme', toggleTheme, 'square'));
}

function openInTab() {
    chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?tabId=${state.tabId}&view=details&type=${state.type}`) });
    window.close();
}

function renderFrameSelect() {
    if (state.frames.length < 2 || !['localStorage', 'sessionStorage', 'indexedDB', 'cacheStorage'].includes(state.type)) return null;
    return h('select', {
        class: 'frame-select', 'aria-label': 'Frame',
        onChange: async e => {
            state.frameId = Number(e.target.value);
            state.selected = null;
            state.editor = null;
            await guard(loadDetails);
            render();
        }
    }, state.frames.map(f => h('option', { value: String(f.frameId), selected: f.frameId === state.frameId },
        f.frameId === 0 ? `Top frame · ${f.origin}` : `iframe · ${f.origin}`)));
}

function renderSearch() {
    const input = h('input', {
        'aria-label': 'Filter keys or values', placeholder: 'Filter keys or values', value: state.filter,
        onInput: e => {
            state.filter = e.target.value;
            const pos = e.target.selectionStart;
            render();
            const next = app.querySelector('.search input');
            next.focus();
            next.setSelectionRange(pos, pos);
        }
    });
    return h('label', { class: 'search' }, icon('search'), input);
}

function importFile(type) {
    if (IS_POPUP) {
        // A file picker closes the popup on some platforms, so import runs in a full tab.
        openInTab();
        return;
    }
    const input = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        await pasteStorage(type, null, await file.text());
    });
    document.body.append(input);
    input.click();
}

async function exportFile(type) {
    await guard(async () => {
        const data = await call('storage.get', { type, frameId: state.frameId });
        downloadJson(data, `${state.summary.info.host}-${type}-${fileStamp()}.json`);
    });
}

function renderToolbar({ paste = true, add = null }) {
    const t = state.type;
    return h('div', { class: 'toolbar' },
        renderFrameSelect(),
        renderSearch(),
        paste ? h('div', { class: 'segmented', role: 'group', 'aria-label': 'Paste from clipboard' },
            h('button', { class: 'active', onClick: () => pasteStorage(t, 'merge'), title: 'Paste and keep existing data' }, 'Paste: Merge'),
            h('button', { onClick: () => pasteStorage(t, 'replace'), title: 'Delete existing data, then paste' }, 'Replace')) : null,
        iconButton('copy', 'Copy all as JSON', () => copyStorage(t), 'square copy'),
        iconButton('download', 'Export to a .json file', () => exportFile(t), 'square'),
        paste ? iconButton('upload', 'Import from a .json file', () => importFile(t), 'square paste') : null,
        iconButton('trash', `Clear ${storeDef(t).label}`, () => clearStorage(t), 'square clear'),
        add ? h('button', { class: 'btn primary', onClick: add }, icon('plus', 12), 'Add') : null);
}

function renderDetails() {
    const root = h('div', { class: 'details' }, renderDetailsHeader());
    if (!state.summary || !state.summary.info.supported) {
        root.append(h('div', { class: 'card notice' }, 'StorageNinja cannot access this page.'));
        return root;
    }
    if (state.data === null) {
        root.append(h('div', { class: 'notice' }, 'Loading…'));
        return root;
    }
    const t = state.type;
    if (t === 'localStorage' || t === 'sessionStorage') root.append(...renderWebStorage());
    else if (t === 'cookies') root.append(...renderCookies());
    else if (t === 'indexedDB') root.append(...renderIndexedDB());
    else root.append(...renderCacheStorage());
    return root;
}

// ---- Local / Session Storage ----

function selectRow(id, editor) {
    state.selected = id;
    state.editor = editor;
    state.jwtView = 'decoded';
    render();
}

function renderWebStorage() {
    const entries = Object.entries(state.data).filter(([k, v]) => matches(k, v));
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const total = Object.keys(state.data).length;
    const toolbar = renderToolbar({ add: () => selectRow('__new__', { isNew: true, key: '', value: '' }) });
    const table = h('div', { class: 'card table' },
        h('div', { class: 'table-head cols-web' }, h('span', {}, 'Key'), h('span', {}, `Value${state.filter ? ` · ${entries.length} of ${total}` : ''}`), h('span', {}, 'Type'), h('span', { style: 'text-align:right' }, 'Actions')),
        entries.length ? entries.map(([k, v]) => h('div', {
            class: `table-row cols-web ${state.selected === k ? 'selected' : ''}`,
            onClick: () => selectRow(k, { isNew: false, key: k, value: v })
        },
        h('span', { class: 'key ellipsis', title: k }, k),
        h('span', { class: 'mono ellipsis muted', title: v.length > 300 ? `${v.slice(0, 300)}…` : v }, v),
        typeChip(valueType(v)),
        h('div', { class: 'actions', onClick: e => e.stopPropagation() },
            iconButton('edit', `Edit ${k}`, () => selectRow(k, { isNew: false, key: k, value: v }), 'details'),
            iconButton('copy', `Copy value of ${k}`, () => guard(async () => {
                await copyText(v);
                toast(`'${k}' copied`);
            }), 'copy'),
            iconButton('trash', `Delete ${k}`, () => deleteWebItem(k), 'clear'))))
            : h('div', { class: 'empty' }, total ? 'No keys match the filter.' : 'Empty'));
    return [toolbar, table, state.editor ? renderWebEditor() : null].filter(Boolean);
}

async function deleteWebItem(key) {
    if (!(await confirmDanger(`Delete '${key}'?`, `The key is removed from ${storeDef(state.type).label}.`))) return;
    await guard(async () => {
        await call('web.removeItem', { type: state.type, key, frameId: state.frameId });
        if (state.selected === key) {
            state.selected = null;
            state.editor = null;
        }
        toast(`'${key}' deleted`);
        await refresh();
    });
}

function tokenCandidateFor(key) {
    const token = state.summary.token;
    if (!token || state.frameId !== 0) return null;
    return token.candidates.find(c => c.source === state.type && c.key === key) || null;
}

function renderWebEditor() {
    const ed = state.editor;
    const type = valueType(ed.value);
    const jwt = type === 'jwt' ? tokenMeta(ed.value) : null;
    let pretty = ed.value;
    if (type === 'json') {
        try {
            pretty = JSON.stringify(JSON.parse(ed.value), null, 2);
        } catch (_) { /* keep raw */ }
    }
    const keyInput = ed.isNew ? h('input', { class: 'input grow', 'aria-label': 'Key', placeholder: 'Key', value: ed.key }) : null;
    const textarea = h('textarea', { class: 'input', 'aria-label': 'Value', rows: '8', placeholder: 'Value (text or JSON)' });
    textarea.value = pretty;
    const showDecoded = jwt && jwt.jwt && state.jwtView === 'decoded';
    const candidate = !ed.isNew ? tokenCandidateFor(ed.key) : null;

    const save = () => guard(async () => {
        const key = ed.isNew ? keyInput.value.trim() : ed.key;
        if (!key) throw new Error('Key cannot be empty');
        let value = textarea.value;
        if (type === 'json') {
            try {
                const parsed = JSON.parse(value);
                // Keep the stored formatting when only the pretty-printed view was shown.
                if (JSON.stringify(parsed) === JSON.stringify(JSON.parse(ed.value))) value = ed.value;
                else if (!/\n/.test(ed.value)) value = JSON.stringify(parsed);
            } catch (_) {
                throw new Error('Value is not valid JSON anymore');
            }
        }
        await call('web.setItem', { type: state.type, key, value, frameId: state.frameId });
        state.selected = key;
        state.editor = { isNew: false, key, value };
        toast(`'${key}' saved`);
        await refresh();
    });

    const close = () => {
        state.selected = null;
        state.editor = null;
        render();
    };

    return h('div', { class: 'editor' },
        h('div', { class: 'editor-head' },
            ed.isNew ? keyInput : h('span', { class: 'key ellipsis grow', title: ed.key }, ed.key),
            ed.isNew || type === 'jwt' ? null : typeChip(type),
            jwt && jwt.jwt ? jwtChip(jwt) : null,
            jwt && jwt.jwt ? h('div', { class: 'segmented' },
                h('button', {
                    class: state.jwtView === 'decoded' ? 'active' : '',
                    onClick: () => {
                        state.jwtView = 'decoded';
                        render();
                    }
                }, 'Decoded'),
                h('button', {
                    class: state.jwtView === 'raw' ? 'active' : '',
                    onClick: () => {
                        state.jwtView = 'raw';
                        render();
                    }
                }, 'Raw')) : null,
            iconButton('close', 'Close editor', close)),
        h('div', { class: 'editor-body' },
            showDecoded
                ? h('div', { class: 'jwt-grid' },
                    h('div', { class: 'field' }, 'HEADER', h('pre', { class: 'code' }, JSON.stringify(jwt.header, null, 2))),
                    h('div', { class: 'field' }, 'PAYLOAD', h('pre', { class: 'code' }, jwtPayloadText(jwt.payload))))
                : textarea),
        h('div', { class: 'editor-foot' },
            jwt && jwt.jwt ? h('button', {
                class: 'btn',
                onClick: () => guard(async () => {
                    await copyText(`Bearer ${stripBearer(ed.value)}`);
                    toast('Copied as Bearer');
                })
            }, 'Copy as Bearer') : null,
            candidate ? h('button', {
                class: 'btn',
                onClick: () => guard(async () => {
                    state.summary.token = await call('token.pin', { pin: { source: candidate.source, key: candidate.key, path: candidate.path } });
                    toast('Pinned as the access token for this site', 'info');
                    render();
                })
            }, 'Pin as access token') : null,
            ed.isNew ? null : h('button', {
                class: 'btn',
                onClick: () => guard(async () => {
                    await copyText(ed.value);
                    toast('Value copied');
                })
            }, icon('copy', 12), 'Copy value'),
            showDecoded ? null : h('button', { class: 'btn primary', onClick: save }, ed.isNew ? 'Add' : 'Save')));
}

function jwtPayloadText(payload) {
    const text = JSON.stringify(payload, null, 2);
    // Annotate unix timestamps with a readable date.
    return text.replace(/^(\s*"(exp|iat|nbf|auth_time)": )(\d{9,11})(,?)$/gm, (_m, pre, _k, num, comma) => `${pre}${num}${comma}  // ${formatDate(Number(num) * 1000)}`);
}

// ---- Cookies ----

function cookieId(c) {
    return [c.name, c.domain, c.path, c.partitionKey ? c.partitionKey.topLevelSite : ''].join('|');
}

function cookieFlags(c) {
    const flags = [];
    if (c.secure) flags.push('Secure');
    if (c.httpOnly) flags.push('HttpOnly');
    if (c.sameSite && c.sameSite !== 'unspecified') flags.push(c.sameSite === 'no_restriction' ? 'None' : c.sameSite[0].toUpperCase() + c.sameSite.slice(1));
    if (c.partitionKey) flags.push('Partitioned');
    return flags.join(' · ');
}

function cookieExpiry(c) {
    if (c.session || !c.expirationDate) return 'Session';
    return formatDate(c.expirationDate * 1000);
}

function newCookie() {
    const info = state.summary.info;
    return { name: '', value: '', domain: info.host, hostOnly: true, path: '/', secure: info.protocol === 'https:', httpOnly: false, sameSite: 'lax', session: true };
}

function renderCookies() {
    const list = state.data.filter(c => matches(c.name, c.value, c.domain));
    list.sort((a, b) => a.name.localeCompare(b.name));
    const toolbar = renderToolbar({ add: () => selectRow('__new__', { isNew: true, cookie: newCookie() }) });
    const table = h('div', { class: 'card table' },
        h('div', { class: 'table-head cols-cookie' }, ['Name', `Value${state.filter ? ` · ${list.length} of ${state.data.length}` : ''}`, 'Domain', 'Path', 'Expires', ''].map(t => h('span', {}, t))),
        list.length ? list.map(c => {
            const id = cookieId(c);
            return h('div', {
                class: `table-row cols-cookie ${state.selected === id ? 'selected' : ''}`,
                onClick: () => selectRow(id, { isNew: false, cookie: { ...c }, original: c })
            },
            h('div', { class: 'ellipsis', title: `${c.name}${cookieFlags(c) ? ` (${cookieFlags(c)})` : ''}` },
                h('div', { class: 'key ellipsis' }, c.name),
                cookieFlags(c) ? h('div', { class: 'muted xsmall ellipsis' }, cookieFlags(c)) : null),
            h('span', { class: 'mono ellipsis muted', title: c.value.length > 300 ? `${c.value.slice(0, 300)}…` : c.value }, c.value),
            h('span', { class: 'ellipsis small', title: c.hostOnly ? `${c.domain} (host only)` : c.domain }, c.domain),
            h('span', { class: 'ellipsis small' }, c.path),
            h('span', { class: 'ellipsis small muted' }, cookieExpiry(c)),
            h('div', { class: 'actions', onClick: e => e.stopPropagation() },
                iconButton('copy', `Copy ${c.name} as JSON`, () => guard(async () => {
                    await copyText(JSON.stringify(c, null, 2));
                    toast(`'${c.name}' copied`);
                }), 'copy'),
                iconButton('trash', `Delete ${c.name}`, () => deleteCookieRow(c), 'clear')));
        }) : h('div', { class: 'empty' }, state.data.length ? 'No cookies match the filter.' : 'Empty'));
    return [toolbar, table, state.editor ? renderCookieEditor() : null].filter(Boolean);
}

async function deleteCookieRow(c) {
    if (!(await confirmDanger(`Delete cookie '${c.name}'?`, `${c.domain}${c.path}`))) return;
    await guard(async () => {
        await call('cookies.delete', { cookie: c });
        if (state.selected === cookieId(c)) {
            state.selected = null;
            state.editor = null;
        }
        toast(`'${c.name}' deleted`);
        await refresh();
    });
}

function toLocalInput(sec) {
    const d = new Date(sec * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderCookieEditor() {
    const ed = state.editor;
    const c = ed.cookie;
    const f = {
        name: h('input', { class: 'input', value: c.name, 'aria-label': 'Name' }),
        value: h('textarea', { class: 'input compact', rows: '2', 'aria-label': 'Value' }),
        domain: h('input', { class: 'input', value: (c.domain || '').replace(/^\./, ''), 'aria-label': 'Domain' }),
        path: h('input', { class: 'input', value: c.path || '/', 'aria-label': 'Path' }),
        expires: h('input', { class: 'input', type: 'datetime-local', value: c.expirationDate ? toLocalInput(c.expirationDate) : '', 'aria-label': 'Expires', disabled: c.session }),
        session: h('input', { type: 'checkbox', checked: c.session }),
        hostOnly: h('input', { type: 'checkbox', checked: c.hostOnly }),
        secure: h('input', { type: 'checkbox', checked: c.secure }),
        httpOnly: h('input', { type: 'checkbox', checked: c.httpOnly }),
        sameSite: h('select', { class: 'input', 'aria-label': 'SameSite' },
            [['unspecified', 'Not set'], ['lax', 'Lax'], ['strict', 'Strict'], ['no_restriction', 'None']].map(([v, l]) => h('option', { value: v, selected: (c.sameSite || 'unspecified') === v }, l)))
    };
    f.value.value = c.value || '';
    f.session.addEventListener('change', () => {
        f.expires.disabled = f.session.checked;
        if (!f.session.checked && !f.expires.value) f.expires.value = toLocalInput(Date.now() / 1000 + 86400 * 30);
    });

    const save = () => guard(async () => {
        const name = f.name.value.trim();
        if (!name) throw new Error('Cookie name is required');
        const session = f.session.checked;
        const cookie = {
            name,
            value: f.value.value,
            domain: f.domain.value.trim() || state.summary.info.host,
            hostOnly: f.hostOnly.checked,
            path: f.path.value.trim() || '/',
            secure: f.secure.checked,
            httpOnly: f.httpOnly.checked,
            sameSite: f.sameSite.value,
            session
        };
        if (!session) {
            const ms = new Date(f.expires.value).getTime();
            if (!ms) throw new Error('Choose an expiry date or mark it as a session cookie');
            cookie.expirationDate = Math.round(ms / 1000);
        }
        if (c.partitionKey) cookie.partitionKey = c.partitionKey;
        const r = await call('cookies.save', { cookie, original: ed.isNew ? null : ed.original });
        state.selected = null;
        state.editor = null;
        toast(r && r.moved ? `'${name}' saved on ${state.summary.info.host}` : `'${name}' saved`);
        await refresh();
    });

    const jwt = tokenMeta(c.value || '');
    return h('div', { class: 'editor' },
        h('div', { class: 'editor-head' },
            h('span', { class: 'key grow ellipsis' }, ed.isNew ? 'New cookie' : c.name),
            c.partitionKey ? h('span', { class: 'chip', title: c.partitionKey.topLevelSite }, 'Partitioned') : null,
            jwt.jwt ? jwtChip(jwt) : null,
            iconButton('close', 'Close editor', () => selectRow(null, null))),
        h('div', { class: 'editor-body' },
            h('div', { class: 'form-grid' },
                h('label', {}, 'Name', f.name),
                h('label', {}, 'Domain', f.domain),
                h('label', { class: 'wide' }, 'Value', f.value),
                h('label', {}, 'Path', f.path),
                h('label', {}, 'Expires', f.expires),
                h('label', {}, 'SameSite', f.sameSite),
                h('div', { class: 'checks wide' },
                    h('label', {}, f.session, 'Session'),
                    h('label', {}, f.hostOnly, 'Host only'),
                    h('label', {}, f.secure, 'Secure'),
                    h('label', {}, f.httpOnly, 'HttpOnly')))),
        h('div', { class: 'editor-foot' },
            jwt.jwt ? h('button', {
                class: 'btn',
                onClick: () => guard(async () => {
                    await copyText(`Bearer ${stripBearer(c.value)}`);
                    toast('Copied as Bearer');
                })
            }, 'Copy as Bearer') : null,
            h('button', { class: 'btn primary', onClick: save }, ed.isNew ? 'Add cookie' : 'Save')));
}

// ---- IndexedDB ----

function renderIndexedDB() {
    const dbs = state.data;
    const toolbar = renderToolbar({ paste: false });
    const rows = [];
    for (const db of dbs) {
        const stores = db.stores.filter(s => matches(db.name, s.name));
        if (!stores.length && !matches(db.name)) continue;
        rows.push(h('div', { class: 'group-head row' },
            h('span', { class: 'grow ellipsis', title: db.name }, db.name, h('span', { class: 'muted xsmall' }, `  v${db.version ?? '?'}${db.error ? ` · ${db.error}` : ''}`)),
            h('button', {
                class: 'btn small',
                onClick: () => guard(async () => {
                    downloadJson(await call('idb.records', { db: db.name, limit: 10000, frameId: state.frameId }), `${state.summary.info.host}-idb-${db.name}-${fileStamp()}.json`);
                })
            }, icon('download', 12), 'Export'),
            h('button', { class: 'btn small danger', onClick: () => deleteIdb(db.name) }, 'Delete database')));
        for (const s of stores) {
            const id = `${db.name}\u0000${s.name}`;
            rows.push(h('div', {
                class: `table-row cols-idb ${state.selected === id ? 'selected' : ''}`,
                onClick: () => openIdbStore(db.name, s.name, id)
            },
            h('span', { class: 'key ellipsis', title: s.name }, s.name, h('span', { class: 'muted xsmall' }, s.keyPath ? `  keyPath: ${Array.isArray(s.keyPath) ? s.keyPath.join(', ') : s.keyPath}` : '')),
            h('span', { class: 'small muted' }, s.count === 1 ? '1 record' : `${s.count ?? '?'} records`),
            h('div', { class: 'actions', onClick: e => e.stopPropagation() },
                iconButton('eye', `View ${s.name}`, () => openIdbStore(db.name, s.name, id), 'details'),
                iconButton('trash', `Clear ${s.name}`, () => clearIdbStore(db.name, s.name), 'clear'))));
        }
    }
    const table = h('div', { class: 'card table' },
        h('div', { class: 'table-head cols-idb' }, h('span', {}, 'Object store'), h('span', {}, 'Records'), h('span', { style: 'text-align:right' }, 'Actions')),
        rows.length ? rows : h('div', { class: 'empty' }, dbs.length ? 'Nothing matches the filter.' : 'No IndexedDB databases on this origin.'));
    return [toolbar, table, state.editor ? renderRecordsPanel() : null].filter(Boolean);
}

async function openIdbStore(db, store, id) {
    await guard(async () => {
        const res = await call('idb.records', { db, store, limit: 100, frameId: state.frameId });
        selectRow(id, { kind: 'idb', db, store, records: res[store] || [] });
    });
}

function renderRecordsPanel() {
    const ed = state.editor;
    const text = JSON.stringify(ed.records, null, 2);
    return h('div', { class: 'editor' },
        h('div', { class: 'editor-head' },
            h('span', { class: 'key grow ellipsis' }, `${ed.db} › ${ed.store}`),
            h('span', { class: 'chip' }, `${ed.records.length} shown (max 100)`),
            iconButton('close', 'Close', () => selectRow(null, null))),
        h('div', { class: 'editor-body' }, h('pre', { class: 'code' }, text)),
        h('div', { class: 'editor-foot' },
            h('button', {
                class: 'btn',
                onClick: () => guard(async () => {
                    await copyText(text);
                    toast('Records copied');
                })
            }, icon('copy', 12), 'Copy JSON')));
}

async function clearIdbStore(db, store) {
    if (!(await confirmDanger(`Clear '${store}'?`, `All records in ${db} › ${store} will be deleted.`, 'Clear'))) return;
    await guard(async () => {
        await call('idb.clearStore', { db, store, frameId: state.frameId });
        toast(`'${store}' cleared`);
        await refresh();
    });
}

async function deleteIdb(db) {
    if (!(await confirmDanger(`Delete database '${db}'?`, 'The whole database is deleted. If the page has it open, deletion finishes when the page closes it.'))) return;
    await guard(async () => {
        const [r] = await call('idb.deleteDb', { db, frameId: state.frameId });
        toast(r && r.blocked ? `'${db}' will be deleted when the page releases it` : `'${db}' deleted`, r && r.blocked ? 'info' : 'success');
        state.selected = null;
        state.editor = null;
        await refresh();
    });
}

// ---- Cache Storage ----

function renderCacheStorage() {
    const caches = state.data.filter(c => matches(c.name));
    const toolbar = renderToolbar({ paste: false });
    const table = h('div', { class: 'card table' },
        h('div', { class: 'table-head cols-idb' }, h('span', {}, 'Cache'), h('span', {}, 'Entries'), h('span', { style: 'text-align:right' }, 'Actions')),
        caches.length ? caches.map(c => h('div', {
            class: `table-row cols-idb ${state.selected === c.name ? 'selected' : ''}`,
            onClick: () => openCache(c.name)
        },
        h('span', { class: 'key ellipsis', title: c.name }, c.name),
        h('span', { class: 'small muted' }, c.count === 1 ? '1 entry' : `${c.count} entries`),
        h('div', { class: 'actions', onClick: e => e.stopPropagation() },
            iconButton('eye', `View ${c.name}`, () => openCache(c.name), 'details'),
            iconButton('trash', `Delete ${c.name}`, () => deleteCache(c.name), 'clear'))))
            : h('div', { class: 'empty' }, state.data.length ? 'No caches match the filter.' : 'No Cache Storage on this origin.'));
    return [toolbar, table, state.editor ? renderCachePanel() : null].filter(Boolean);
}

async function openCache(name) {
    await guard(async () => {
        const res = await call('cache.entries', { name, frameId: state.frameId });
        selectRow(name, { kind: 'cache', name, ...res });
    });
}

function renderCachePanel() {
    const ed = state.editor;
    return h('div', { class: 'editor' },
        h('div', { class: 'editor-head' },
            h('span', { class: 'key grow ellipsis' }, ed.name),
            h('span', { class: 'chip' }, ed.total > ed.entries.length ? `${ed.entries.length} of ${ed.total}` : `${ed.total} entries`),
            iconButton('close', 'Close', () => selectRow(null, null))),
        h('div', { class: 'editor-body', style: 'padding:0' },
            ed.entries.length ? ed.entries.map(e => h('div', { class: 'table-row cols-cache', style: 'cursor:default' },
                h('span', { class: 'mono ellipsis small', title: e.url }, e.url),
                h('span', { class: 'small muted' }, e.status ?? ''),
                h('span', { class: 'small muted ellipsis' }, e.type),
                iconButton('trash', `Delete ${e.url}`, () => deleteCacheEntry(ed.name, e.url), 'clear')))
                : h('div', { class: 'empty' }, 'Empty cache')));
}

async function deleteCache(name) {
    if (!(await confirmDanger(`Delete cache '${name}'?`, 'All entries in this cache are deleted.'))) return;
    await guard(async () => {
        await call('cache.delete', { name, frameId: state.frameId });
        state.selected = null;
        state.editor = null;
        toast(`'${name}' deleted`);
        await refresh();
    });
}

async function deleteCacheEntry(name, url) {
    await guard(async () => {
        await call('cache.deleteEntry', { name, url, frameId: state.frameId });
        await openCache(name);
    });
}

// ---- Start ------------------------------------------------------------------------------------

async function init() {
    const fromParam = Number(params.get('tabId'));
    if (fromParam) {
        state.tabId = fromParam;
    } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        state.tabId = tab ? tab.id : null;
    }
    const settings = await guard(() => call('settings.get'));
    state.theme = (settings && settings.theme) || 'system';
    applyTheme();
    render();
    await guard(loadSummary);
    if (!state.summary) state.summary = { info: { supported: false } };
    const startType = params.get('type');
    if (params.get('view') === 'details' && storeDef(startType) && state.summary.info.supported) {
        await openDetails(startType);
    } else {
        render();
    }
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'system' && render());
    // In DevTools the inspected page can navigate while the panel stays open.
    if (chrome.devtools && chrome.devtools.network && chrome.devtools.network.onNavigated) {
        chrome.devtools.network.onNavigated.addListener(() => {
            state.frames = [];
            state.frameId = 0;
            setTimeout(refresh, 600);
        });
    }
    document.addEventListener('click', e => {
        if (state.tokenMenuOpen && !e.target.closest('.token-card')) {
            state.tokenMenuOpen = false;
            render();
        }
    });
}

init();
