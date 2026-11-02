// Every operation the UI, context menu and keyboard shortcuts can run. Each takes a plain args
// object (always with tabId for page operations) and resolves to JSON-safe data.

import { requireTab, getTabInfo, listFrames, runInFrame } from './tab.js';
import {
    getWebStorage, setWebStorage, setWebStorageItem, removeWebStorageItem, clearWebStorage, getWebStorageCounts, isPlainObject
} from './webstorage.js';
import { listCookies, setCookies, saveCookie, deleteCookie, clearCookies } from './cookies.js';
import { listDatabases, readRecords, clearObjectStore, deleteDatabases } from './indexeddb.js';
import { listCaches, cacheEntries, deleteCaches, deleteCacheEntry } from './cachestorage.js';
import { findTokens, pickToken, sameSource } from './token.js';
import * as store from './store.js';
import { writeClipboard, readClipboard } from './clipboard.js';

export const BUNDLE_MARK = '$storageNinja';

async function safe(promise, fallback) {
    try {
        return await promise;
    } catch (_) {
        return fallback;
    }
}

export async function tokenCandidates(tabId, info) {
    const [local, session, cookies] = await Promise.all([
        safe(getWebStorage(tabId, 'localStorage'), {}),
        safe(getWebStorage(tabId, 'sessionStorage'), {}),
        safe(listCookies(tabId, info.url).then(r => r.cookies), [])
    ]);
    const candidates = findTokens({ localStorage: local, sessionStorage: session, cookies });
    const pin = await store.getPin(info.host);
    const selected = pickToken(candidates, pin);
    return { candidates: candidates.slice(0, 20), selected, pinned: sameSource(selected, pin) };
}

export async function exportBundle(tabId, info) {
    const [local, session, cookies] = await Promise.all([
        getWebStorage(tabId, 'localStorage'),
        getWebStorage(tabId, 'sessionStorage'),
        listCookies(tabId, info.url).then(r => r.cookies)
    ]);
    return { [BUNDLE_MARK]: 2, url: info.url, exportedAt: new Date().toISOString(), localStorage: local, sessionStorage: session, cookies };
}

// Picks the part of pasted JSON that belongs to `type`, so a "copy all" bundle can be pasted
// into a single storage.
export function pickPart(data, type) {
    if (isPlainObject(data) && data[BUNDLE_MARK]) {
        if (!(type in data)) throw new Error(`The copied bundle has no ${type}`);
        return data[type];
    }
    return data;
}

async function pasteInto(tabId, info, type, data, mode, frameId) {
    const part = pickPart(data, type);
    if (type === 'cookies') return setCookies(tabId, info, part, mode);
    return setWebStorage(tabId, type, part, mode, frameId);
}

async function clearEverything(tabId, info) {
    const report = {};
    report.localStorage = await safe(clearWebStorage(tabId, 'localStorage'), null);
    report.sessionStorage = await safe(clearWebStorage(tabId, 'sessionStorage'), null);
    report.cookies = await safe(clearCookies(tabId, info.url), null);
    report.indexedDB = await safe(deleteDatabases(tabId), null);
    report.cacheStorage = await safe(deleteCaches(tabId), null);
    report.serviceWorkers = await safe(runInFrame(tabId, async () => {
        try {
            const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
            await Promise.all(regs.map(r => r.unregister()));
            return { ok: true, data: { count: regs.length } };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }), null);
    if (!info.incognito) {
        // Also drops the HTTP cache and anything the page APIs above could not reach.
        await safe(chrome.browsingData.remove({ origins: [info.origin] }, {
            cache: true, cacheStorage: true, cookies: true, fileSystems: true,
            indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true
        }), null);
    }
    return report;
}

export const ops = {
    async 'tab.info'({ tabId }) {
        return getTabInfo(tabId);
    },

    async summary({ tabId }) {
        const info = await getTabInfo(tabId);
        if (!info.supported) return { info };
        const [web, cookies, idb, caches, token, snapshots] = await Promise.all([
            safe(getWebStorageCounts(tabId), { localStorage: null, sessionStorage: null }),
            safe(listCookies(tabId, info.url).then(r => r.cookies.length), null),
            safe(listDatabases(tabId), null),
            safe(listCaches(tabId), null),
            safe(tokenCandidates(tabId, info), { candidates: [], selected: null }),
            store.listSnapshots(info.host).then(list => list.map(store.snapshotSummary))
        ]);
        return {
            info,
            counts: {
                localStorage: web.localStorage,
                sessionStorage: web.sessionStorage,
                cookies,
                indexedDB: idb ? idb.length : null,
                cacheStorage: caches ? caches.length : null
            },
            token,
            snapshots
        };
    },

    async 'frames.list'({ tabId }) {
        await requireTab(tabId);
        return listFrames(tabId);
    },

    async 'web.get'({ tabId, type, frameId }) {
        await requireTab(tabId);
        return getWebStorage(tabId, type, frameId);
    },
    async 'web.setItem'({ tabId, type, key, value, frameId }) {
        await requireTab(tabId);
        return setWebStorageItem(tabId, type, key, value, frameId);
    },
    async 'web.removeItem'({ tabId, type, key, frameId }) {
        await requireTab(tabId);
        return removeWebStorageItem(tabId, type, key, frameId);
    },
    async 'web.clear'({ tabId, type, frameId }) {
        await requireTab(tabId);
        return clearWebStorage(tabId, type, frameId);
    },

    async 'cookies.list'({ tabId }) {
        const info = await requireTab(tabId);
        return (await listCookies(tabId, info.url)).cookies;
    },
    async 'cookies.save'({ tabId, cookie, original }) {
        const info = await requireTab(tabId);
        return saveCookie(tabId, info, cookie, original);
    },
    async 'cookies.delete'({ tabId, cookie }) {
        await requireTab(tabId);
        return deleteCookie(tabId, cookie);
    },
    async 'cookies.clear'({ tabId }) {
        const info = await requireTab(tabId);
        return clearCookies(tabId, info.url);
    },

    async 'storage.get'({ tabId, type, frameId }) {
        const info = await requireTab(tabId);
        if (type === 'cookies') return (await listCookies(tabId, info.url)).cookies;
        if (type === 'all') return exportBundle(tabId, info);
        if (type === 'indexedDB') {
            const dbs = await listDatabases(tabId, frameId);
            const out = {};
            for (const db of dbs) out[db.name] = await safe(readRecords(tabId, db.name, null, 10000, frameId), { error: 'Could not read' });
            return out;
        }
        if (type === 'cacheStorage') {
            const caches = await listCaches(tabId, frameId);
            const out = {};
            for (const c of caches) out[c.name] = (await cacheEntries(tabId, c.name, 10000, frameId)).entries.map(e => e.url);
            return out;
        }
        return getWebStorage(tabId, type, frameId);
    },
    async 'storage.paste'({ tabId, type, data, mode, frameId }) {
        const info = await requireTab(tabId);
        return pasteInto(tabId, info, type, data, mode, frameId);
    },
    async 'storage.clear'({ tabId, type, frameId }) {
        const info = await requireTab(tabId);
        if (type === 'cookies') return clearCookies(tabId, info.url);
        if (type === 'indexedDB') return deleteDatabases(tabId, null, frameId);
        if (type === 'cacheStorage') return deleteCaches(tabId, null, frameId);
        return clearWebStorage(tabId, type, frameId);
    },

    async 'idb.list'({ tabId, frameId }) {
        await requireTab(tabId);
        return listDatabases(tabId, frameId);
    },
    async 'idb.records'({ tabId, db, store: storeName, limit, frameId }) {
        await requireTab(tabId);
        return readRecords(tabId, db, storeName ? [storeName] : null, limit || 100, frameId);
    },
    async 'idb.clearStore'({ tabId, db, store: storeName, frameId }) {
        await requireTab(tabId);
        return clearObjectStore(tabId, db, storeName, frameId);
    },
    async 'idb.deleteDb'({ tabId, db, frameId }) {
        await requireTab(tabId);
        return deleteDatabases(tabId, [db], frameId);
    },

    async 'cache.list'({ tabId, frameId }) {
        await requireTab(tabId);
        return listCaches(tabId, frameId);
    },
    async 'cache.entries'({ tabId, name, frameId }) {
        await requireTab(tabId);
        return cacheEntries(tabId, name, 300, frameId);
    },
    async 'cache.delete'({ tabId, name, frameId }) {
        await requireTab(tabId);
        return deleteCaches(tabId, [name], frameId);
    },
    async 'cache.deleteEntry'({ tabId, name, url, frameId }) {
        await requireTab(tabId);
        return deleteCacheEntry(tabId, name, url, frameId);
    },

    async 'token.get'({ tabId }) {
        const info = await requireTab(tabId);
        return tokenCandidates(tabId, info);
    },
    async 'token.pin'({ tabId, pin }) {
        const info = await requireTab(tabId);
        await store.setPin(info.host, pin);
        return tokenCandidates(tabId, info);
    },

    async 'snapshot.list'({ tabId }) {
        const info = await requireTab(tabId);
        return (await store.listSnapshots(info.host)).map(store.snapshotSummary);
    },
    async 'snapshot.save'({ tabId, name }) {
        const info = await requireTab(tabId);
        const bundle = await exportBundle(tabId, info);
        const entry = await store.saveSnapshot(info.host, {
            name: name || `Snapshot ${new Date().toLocaleString()}`,
            url: info.url,
            localStorage: bundle.localStorage,
            sessionStorage: bundle.sessionStorage,
            cookies: bundle.cookies
        });
        return store.snapshotSummary(entry);
    },
    async 'snapshot.restore'({ tabId, id, reload = true }) {
        const info = await requireTab(tabId);
        const snap = await store.getSnapshot(info.host, id);
        await setWebStorage(tabId, 'localStorage', snap.localStorage || {}, 'replace');
        await setWebStorage(tabId, 'sessionStorage', snap.sessionStorage || {}, 'replace');
        const cookies = await setCookies(tabId, info, snap.cookies || [], 'replace');
        if (reload) await chrome.tabs.reload(tabId);
        return { cookies };
    },
    async 'snapshot.rename'({ tabId, id, name }) {
        const info = await requireTab(tabId);
        return store.renameSnapshot(info.host, id, name);
    },
    async 'snapshot.delete'({ tabId, id }) {
        const info = await requireTab(tabId);
        return store.deleteSnapshot(info.host, id);
    },

    async 'all.clearAndReload'({ tabId }) {
        const info = await requireTab(tabId);
        const report = await clearEverything(tabId, info);
        await chrome.tabs.reload(tabId, { bypassCache: true });
        return report;
    },

    async 'clipboard.write'({ text }) {
        return writeClipboard(text);
    },
    async 'clipboard.read'() {
        return readClipboard();
    },

    async 'settings.get'() {
        return store.getSettings();
    },
    async 'settings.set'({ patch }) {
        return store.setSettings(patch);
    }
};

export async function runOp(op, args) {
    const fn = ops[op];
    if (!fn) throw new Error(`Unknown operation: ${op}`);
    return fn(args || {});
}
