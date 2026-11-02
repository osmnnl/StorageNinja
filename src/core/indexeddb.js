// IndexedDB inspection. Injected functions run in the page's isolated world, which shares the
// page origin's storage.

import { runInFrame } from './tab.js';

async function pageListDatabases() {
    const withTimeout = (promise, ms, fallback) =>
        Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);
    try {
        if (!indexedDB.databases) return { ok: true, data: [] };
        const dbs = await indexedDB.databases();
        const out = [];
        for (const { name, version } of dbs) {
            if (!name) continue;
            const info = await withTimeout(new Promise(resolve => {
                const req = indexedDB.open(name);
                req.onupgradeneeded = () => req.transaction.abort();
                req.onerror = () => resolve({ name, version, stores: [], error: String(req.error && req.error.message) });
                req.onblocked = () => resolve({ name, version, stores: [], error: 'Database is blocked by another connection' });
                req.onsuccess = () => {
                    const db = req.result;
                    const names = Array.from(db.objectStoreNames);
                    if (!names.length) {
                        db.close();
                        resolve({ name, version, stores: [] });
                        return;
                    }
                    const tx = db.transaction(names, 'readonly');
                    const stores = [];
                    names.forEach(storeName => {
                        const store = tx.objectStore(storeName);
                        const countReq = store.count();
                        countReq.onsuccess = () => stores.push({ name: storeName, count: countReq.result, keyPath: store.keyPath });
                        countReq.onerror = () => stores.push({ name: storeName, count: null, keyPath: store.keyPath });
                    });
                    tx.oncomplete = () => {
                        db.close();
                        stores.sort((a, b) => a.name.localeCompare(b.name));
                        resolve({ name, version, stores });
                    };
                    tx.onerror = () => {
                        db.close();
                        resolve({ name, version, stores, error: 'Could not read object stores' });
                    };
                };
            }), 4000, { name, version, stores: [], error: 'Timed out' });
            out.push(info);
        }
        return { ok: true, data: out };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pageReadRecords(dbName, storeNames, limit) {
    // Converts structured-clone values (Date, Map, Blob, typed arrays…) into JSON-safe values.
    const toJson = (value, seen = new WeakSet()) => {
        if (value === null || typeof value !== 'object') {
            if (typeof value === 'bigint') return value.toString();
            if (typeof value === 'undefined') return null;
            return value;
        }
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        if (value instanceof Date) return value.toISOString();
        if (value instanceof Blob) return `[Blob ${value.type || 'binary'} ${value.size} bytes]`;
        if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
        if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength} bytes]`;
        if (value instanceof Map) return Object.fromEntries(Array.from(value, ([k, v]) => [String(k), toJson(v, seen)]));
        if (value instanceof Set) return Array.from(value, v => toJson(v, seen));
        if (Array.isArray(value)) return value.map(v => toJson(v, seen));
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = toJson(v, seen);
        return out;
    };
    try {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName);
            req.onupgradeneeded = () => req.transaction.abort();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Could not open database'));
        });
        const names = storeNames && storeNames.length ? storeNames : Array.from(db.objectStoreNames);
        const out = {};
        for (const storeName of names) {
            out[storeName] = await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const keysReq = store.getAllKeys(null, limit);
                const valuesReq = store.getAll(null, limit);
                tx.oncomplete = () => resolve(keysReq.result.map((key, i) => ({ key: toJson(key), value: toJson(valuesReq.result[i]) })));
                tx.onerror = () => reject(tx.error || new Error('Could not read store'));
            });
        }
        db.close();
        return { ok: true, data: out };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pageClearStore(dbName, storeName) {
    try {
        await new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName);
            req.onupgradeneeded = () => req.transaction.abort();
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).clear();
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            };
        });
        return { ok: true, data: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pageDeleteDatabases(names) {
    try {
        let targets = names;
        if (!targets) {
            const dbs = indexedDB.databases ? await indexedDB.databases() : [];
            targets = dbs.map(d => d.name).filter(Boolean);
        }
        const results = await Promise.all(targets.map(name => new Promise(resolve => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve({ name, ok: true });
            req.onerror = () => resolve({ name, ok: false });
            // Open connections in the page delay deletion; it finishes once they close.
            req.onblocked = () => resolve({ name, ok: true, blocked: true });
        })));
        return { ok: true, data: results };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

export function listDatabases(tabId, frameId = 0) {
    return runInFrame(tabId, pageListDatabases, [], frameId);
}

export function readRecords(tabId, dbName, storeNames, limit = 100, frameId = 0) {
    return runInFrame(tabId, pageReadRecords, [dbName, storeNames || null, limit], frameId);
}

export function clearObjectStore(tabId, dbName, storeName, frameId = 0) {
    return runInFrame(tabId, pageClearStore, [dbName, storeName], frameId);
}

export function deleteDatabases(tabId, names = null, frameId = 0) {
    return runInFrame(tabId, pageDeleteDatabases, [names], frameId);
}
