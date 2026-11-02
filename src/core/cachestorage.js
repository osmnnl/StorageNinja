// Cache Storage (the Service Worker Cache API) of the page origin.

import { runInFrame } from './tab.js';

async function pageListCaches() {
    try {
        if (!('caches' in self)) return { ok: true, data: [] };
        const names = await caches.keys();
        const out = [];
        for (const name of names) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            out.push({ name, count: keys.length });
        }
        return { ok: true, data: out };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pageCacheEntries(name, limit) {
    try {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        const entries = [];
        for (const req of keys.slice(0, limit)) {
            const res = await cache.match(req);
            entries.push({
                url: req.url,
                method: req.method,
                status: res ? res.status : null,
                type: res ? res.headers.get('content-type') || '' : '',
                size: res ? res.headers.get('content-length') : null
            });
        }
        return { ok: true, data: { total: keys.length, entries } };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pageDeleteCaches(names) {
    try {
        const targets = names || await caches.keys();
        await Promise.all(targets.map(n => caches.delete(n)));
        return { ok: true, data: { count: targets.length } };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pageDeleteCacheEntry(name, url) {
    try {
        const cache = await caches.open(name);
        return { ok: true, data: await cache.delete(url) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

export function listCaches(tabId, frameId = 0) {
    return runInFrame(tabId, pageListCaches, [], frameId);
}

export function cacheEntries(tabId, name, limit = 300, frameId = 0) {
    return runInFrame(tabId, pageCacheEntries, [name, limit], frameId);
}

export function deleteCaches(tabId, names = null, frameId = 0) {
    return runInFrame(tabId, pageDeleteCaches, [names], frameId);
}

export function deleteCacheEntry(tabId, name, url, frameId = 0) {
    return runInFrame(tabId, pageDeleteCacheEntry, [name, url], frameId);
}
