// Tab helpers: which pages can be inspected and how to run code inside them.

export function isSupportedUrl(url) {
    if (!url) return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Chrome never lets extensions script the Web Store.
    if (parsed.hostname === 'chromewebstore.google.com') return false;
    return !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
}

export async function getTabInfo(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || tab.pendingUrl || '';
    const supported = isSupportedUrl(url);
    let origin = '';
    let host = '';
    let protocol = '';
    if (supported) {
        const parsed = new URL(url);
        origin = parsed.origin;
        host = parsed.hostname;
        protocol = parsed.protocol;
    }
    return { tabId, url, origin, host, protocol, supported, incognito: !!tab.incognito, title: tab.title || '' };
}

export async function requireTab(tabId) {
    if (typeof tabId !== 'number') throw new Error('No tab selected');
    const info = await getTabInfo(tabId);
    if (!info.supported) throw new Error('StorageNinja cannot access this page');
    return info;
}

// Runs `func` in one frame (top frame by default) and unwraps the { ok, data | error } envelope
// that every injected function returns.
export async function runInFrame(tabId, func, args = [], frameId = 0) {
    const target = frameId ? { tabId, frameIds: [frameId] } : { tabId };
    const results = await chrome.scripting.executeScript({ target, func, args });
    const first = results && results[0];
    if (!first) throw new Error('Could not run in page');
    if (first.error) throw new Error(String(first.error.message || first.error));
    const res = first.result;
    if (!res) throw new Error('Page returned no result');
    if (!res.ok) throw new Error(res.error || 'Page operation failed');
    return res.data;
}

export async function listFrames(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => ({ href: location.href, origin: location.origin })
    });
    const seen = new Set();
    const frames = [];
    for (const r of results || []) {
        if (!r || !r.result || r.result.origin === 'null') continue;
        const key = r.result.origin;
        if (r.frameId !== 0 && seen.has(key)) continue;
        seen.add(key);
        frames.push({ frameId: r.frameId, origin: r.result.origin, href: r.result.href });
    }
    frames.sort((a, b) => a.frameId - b.frameId);
    return frames;
}
