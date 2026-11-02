// Clipboard for contexts without a focused document (context menu, keyboard shortcut): an
// offscreen document runs execCommand('copy' | 'paste').

let creating = null;

async function ensureOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    if (!creating) {
        creating = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['CLIPBOARD'],
            justification: 'Copy and paste storage data from the context menu and keyboard shortcuts'
        }).finally(() => {
            creating = null;
        });
    }
    await creating;
}

async function send(action, text) {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', action, text });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Clipboard is not available');
    return res.data;
}

export function writeClipboard(text) {
    return send('write', String(text));
}

export function readClipboard() {
    return send('read');
}
