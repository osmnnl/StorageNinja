// StorageNinja - offscreen clipboard helper

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return false;
    const buffer = document.getElementById('buffer');
    try {
        if (msg.action === 'write') {
            buffer.value = msg.text;
            buffer.select();
            const ok = document.execCommand('copy');
            sendResponse(ok ? { ok: true, data: true } : { ok: false, error: 'Copy was blocked' });
        } else if (msg.action === 'read') {
            buffer.value = '';
            buffer.focus();
            const ok = document.execCommand('paste');
            sendResponse(ok ? { ok: true, data: buffer.value } : { ok: false, error: 'Paste was blocked' });
        } else {
            sendResponse({ ok: false, error: 'Unknown clipboard action' });
        }
    } catch (e) {
        sendResponse({ ok: false, error: e.message });
    }
    return false;
});
