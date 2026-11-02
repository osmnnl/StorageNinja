// Extension-side persistence in chrome.storage.local: settings, pinned token sources, snapshots.

const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = { theme: 'system' };

export async function getSettings() {
    const r = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] || {}) };
}

export async function setSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
}

const pinKey = host => `pin:${host}`;

export async function getPin(host) {
    const r = await chrome.storage.local.get(pinKey(host));
    return r[pinKey(host)] || null;
}

export async function setPin(host, pin) {
    if (!pin) {
        await chrome.storage.local.remove(pinKey(host));
        return null;
    }
    const value = { source: pin.source, key: pin.key, path: pin.path || [] };
    await chrome.storage.local.set({ [pinKey(host)]: value });
    return value;
}

const snapKey = host => `snapshots:${host}`;

export async function listSnapshots(host) {
    const r = await chrome.storage.local.get(snapKey(host));
    return r[snapKey(host)] || [];
}

async function writeSnapshots(host, list) {
    await chrome.storage.local.set({ [snapKey(host)]: list });
}

export function snapshotSummary(s) {
    return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        counts: {
            localStorage: Object.keys(s.localStorage || {}).length,
            sessionStorage: Object.keys(s.sessionStorage || {}).length,
            cookies: (s.cookies || []).length
        }
    };
}

export async function saveSnapshot(host, snapshot) {
    const list = await listSnapshots(host);
    const entry = { ...snapshot, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now() };
    list.unshift(entry);
    await writeSnapshots(host, list);
    return entry;
}

export async function getSnapshot(host, id) {
    const list = await listSnapshots(host);
    const s = list.find(x => x.id === id);
    if (!s) throw new Error('Snapshot not found');
    return s;
}

export async function renameSnapshot(host, id, name) {
    const list = await listSnapshots(host);
    const s = list.find(x => x.id === id);
    if (!s) throw new Error('Snapshot not found');
    s.name = name;
    await writeSnapshots(host, list);
    return snapshotSummary(s);
}

export async function deleteSnapshot(host, id) {
    const list = await listSnapshots(host);
    await writeSnapshots(host, list.filter(x => x.id !== id));
    return true;
}
