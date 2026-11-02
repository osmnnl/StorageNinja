// StorageNinja - background service worker: operation router, context menu, keyboard shortcuts.

import { runOp, ops, tokenCandidates, exportBundle } from './src/core/ops.js';
import { requireTab, isSupportedUrl } from './src/core/tab.js';
import { getWebStorage } from './src/core/webstorage.js';
import { listCookies } from './src/core/cookies.js';
import { listSnapshots } from './src/core/store.js';
import { writeClipboard, readClipboard } from './src/core/clipboard.js';
import { stripBearer } from './src/core/token.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.op || msg.target === 'offscreen') return false;
    runOp(msg.op, msg)
        .then(data => sendResponse({ ok: true, data }))
        .catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
    return true;
});

// ---- Context menu -------------------------------------------------------------------------

const PAGE_PATTERNS = ['http://*/*', 'https://*/*'];

const MENU = [
    { id: 'copy-token', title: 'Copy access token' },
    { id: 'copy-token-bearer', title: 'Copy access token as Bearer' },
    { type: 'separator', id: 'sep-1' },
    { id: 'copy-localStorage', title: 'Copy Local Storage (JSON)' },
    { id: 'copy-sessionStorage', title: 'Copy Session Storage (JSON)' },
    { id: 'copy-cookies', title: 'Copy Cookies (JSON)' },
    { id: 'copy-all', title: 'Copy all as one JSON' },
    { type: 'separator', id: 'sep-2' },
    { id: 'paste-localStorage', title: 'Paste into Local Storage (merge)' },
    { id: 'paste-sessionStorage', title: 'Paste into Session Storage (merge)' },
    { id: 'paste-cookies', title: 'Paste cookies (merge)' },
    { type: 'separator', id: 'sep-3' },
    { id: 'snapshot-save', title: 'Save snapshot' },
    { id: 'snapshot-restore-latest', title: 'Restore latest snapshot' },
    { type: 'separator', id: 'sep-4' },
    { id: 'clear-all', title: 'Clear all & reload' }
];

function createMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'storage-ninja',
            title: 'StorageNinja',
            contexts: ['all'],
            documentUrlPatterns: PAGE_PATTERNS
        });
        for (const item of MENU) {
            chrome.contextMenus.create({
                ...item,
                parentId: 'storage-ninja',
                contexts: ['all'],
                documentUrlPatterns: PAGE_PATTERNS
            });
        }
    });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

// Feedback inside the page, since a context menu has no UI of its own.
async function toast(tabId, text, kind = 'success') {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            args: [text, kind],
            func: (message, type) => {
                const old = document.getElementById('storage-ninja-toast');
                if (old) old.remove();
                const host = document.createElement('div');
                host.id = 'storage-ninja-toast';
                host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647';
                const root = host.attachShadow({ mode: 'closed' });
                const box = document.createElement('div');
                const colors = { success: '#166534', error: '#B91C1C', info: '#1E3A8A' };
                box.textContent = message;
                box.style.cssText = `font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;background:${colors[type] || colors.info};padding:10px 14px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:360px`;
                root.appendChild(box);
                document.documentElement.appendChild(host);
                setTimeout(() => host.remove(), 2600);
            }
        });
    } catch (_) {
        chrome.action.setBadgeBackgroundColor({ color: kind === 'error' ? '#B91C1C' : '#166534' });
        chrome.action.setBadgeText({ tabId, text: kind === 'error' ? '!' : '✓' });
        setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2000);
    }
}

async function confirmInPage(tabId, message) {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, args: [message], func: m => window.confirm(m) });
    return !!(res && res.result);
}

const LABEL = { localStorage: 'Local Storage', sessionStorage: 'Session Storage', cookies: 'Cookies' };

async function copyToken(tabId, bearer) {
    const info = await requireTab(tabId);
    const { selected } = await tokenCandidates(tabId, info);
    if (!selected) throw new Error('No access token found on this page');
    const token = stripBearer(selected.token);
    await writeClipboard(bearer ? `Bearer ${token}` : token);
    return bearer ? 'Access token copied as Bearer' : 'Access token copied';
}

const ACTIONS = {
    'copy-token': tabId => copyToken(tabId, false),
    'copy-token-bearer': tabId => copyToken(tabId, true),
    async 'copy-all'(tabId) {
        const info = await requireTab(tabId);
        await writeClipboard(JSON.stringify(await exportBundle(tabId, info), null, 2));
        return 'Local Storage, Session Storage and Cookies copied';
    },
    async 'snapshot-save'(tabId) {
        const s = await ops['snapshot.save']({ tabId });
        return `Snapshot saved (${s.counts.localStorage + s.counts.sessionStorage} keys, ${s.counts.cookies} cookies)`;
    },
    async 'snapshot-restore-latest'(tabId) {
        const info = await requireTab(tabId);
        const [latest] = await listSnapshots(info.host);
        if (!latest) throw new Error('No snapshot saved for this site');
        if (!(await confirmInPage(tabId, `StorageNinja: restore snapshot "${latest.name}"? Current storage and cookies of this site will be replaced and the page reloads.`))) return null;
        await ops['snapshot.restore']({ tabId, id: latest.id });
        return null;
    },
    async 'clear-all'(tabId) {
        if (!(await confirmInPage(tabId, 'StorageNinja: clear Local Storage, Session Storage, Cookies, IndexedDB, Cache Storage and service workers of this site, then reload?'))) return null;
        await ops['all.clearAndReload']({ tabId });
        return null;
    }
};

for (const type of ['localStorage', 'sessionStorage', 'cookies']) {
    ACTIONS[`copy-${type}`] = async tabId => {
        const info = await requireTab(tabId);
        const data = type === 'cookies' ? (await listCookies(tabId, info.url)).cookies : await getWebStorage(tabId, type);
        await writeClipboard(JSON.stringify(data, null, 2));
        const count = Array.isArray(data) ? data.length : Object.keys(data).length;
        return `${LABEL[type]} copied (${count} items)`;
    };
    ACTIONS[`paste-${type}`] = async tabId => {
        const text = await readClipboard();
        if (!text || !text.trim()) throw new Error('Clipboard is empty');
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            throw new Error('Clipboard does not contain valid JSON');
        }
        const r = await ops['storage.paste']({ tabId, type, data, mode: 'merge' });
        let msg = `${r.count} items pasted into ${LABEL[type]}`;
        if (r.moved) msg += ` (${r.moved} moved to this site)`;
        if (r.errors && r.errors.length) msg += `, ${r.errors.length} failed`;
        return msg;
    };
}

async function runAction(id, tab) {
    if (!tab || tab.id === undefined || !isSupportedUrl(tab.url)) return;
    const action = ACTIONS[id];
    if (!action) return;
    try {
        const message = await action(tab.id);
        if (message) await toast(tab.id, message, 'success');
    } catch (e) {
        await toast(tab.id, `StorageNinja: ${e.message}`, 'error');
    }
}

chrome.contextMenus.onClicked.addListener((info, tab) => runAction(info.menuItemId, tab));

chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'copy-token') return;
    if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    runAction('copy-token', tab);
});

// Handy from the service worker console: await storageNinja.runOp('summary', { tabId })
globalThis.storageNinja = { runOp, runAction };
