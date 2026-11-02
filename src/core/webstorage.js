// localStorage / sessionStorage access. Functions passed to executeScript must be self-contained.

import { runInFrame } from './tab.js';

const TYPES = ['localStorage', 'sessionStorage'];

function assertType(type) {
    if (!TYPES.includes(type)) throw new Error('Invalid storage type');
}

function pageRead(type) {
    try {
        const s = window[type];
        const data = {};
        for (let i = 0; i < s.length; i++) {
            const key = s.key(i);
            if (key !== null) data[key] = s.getItem(key);
        }
        return { ok: true, data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function pageWrite(type, data, mode) {
    try {
        const s = window[type];
        if (mode === 'replace') s.clear();
        let count = 0;
        for (const [key, value] of Object.entries(data)) {
            s.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            count++;
        }
        return { ok: true, data: { count } };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function pageRemove(type, key) {
    try {
        window[type].removeItem(key);
        return { ok: true, data: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function pageClear(type) {
    try {
        const count = window[type].length;
        window[type].clear();
        return { ok: true, data: { count } };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function pageCounts() {
    const count = (type) => {
        try {
            return window[type].length;
        } catch (_) {
            return null;
        }
    };
    return { ok: true, data: { localStorage: count('localStorage'), sessionStorage: count('sessionStorage') } };
}

export function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function getWebStorage(tabId, type, frameId = 0) {
    assertType(type);
    return runInFrame(tabId, pageRead, [type], frameId);
}

export async function setWebStorage(tabId, type, data, mode = 'merge', frameId = 0) {
    assertType(type);
    if (!isPlainObject(data)) throw new Error('Expected a JSON object of key/value pairs');
    return runInFrame(tabId, pageWrite, [type, data, mode === 'replace' ? 'replace' : 'merge'], frameId);
}

export async function setWebStorageItem(tabId, type, key, value, frameId = 0) {
    assertType(type);
    if (!key) throw new Error('Key cannot be empty');
    return runInFrame(tabId, pageWrite, [type, { [key]: value }, 'merge'], frameId);
}

export async function removeWebStorageItem(tabId, type, key, frameId = 0) {
    assertType(type);
    return runInFrame(tabId, pageRemove, [type, key], frameId);
}

export async function clearWebStorage(tabId, type, frameId = 0) {
    assertType(type);
    return runInFrame(tabId, pageClear, [type], frameId);
}

export async function getWebStorageCounts(tabId) {
    return runInFrame(tabId, pageCounts, []);
}
