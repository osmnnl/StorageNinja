// StorageNinja - Background Service Worker

// Extension installation/update handler
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('StorageNinja installed successfully');
    } else if (details.reason === 'update') {
        console.log('StorageNinja updated successfully');
    }
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    async function resolveStoreId() {
        try {
            const stores = await chrome.cookies.getAllCookieStores();
            const tabId = sender && sender.tab && sender.tab.id;
            if (tabId != null) {
                const store = stores.find(s => (s.tabIds || []).includes(tabId));
                if (store) return store.id;
            }
            // fallback to default store
            return stores && stores[0] ? stores[0].id : undefined;
        } catch (_) {
            return undefined;
        }
    }
    (async () => {
        try {
            switch (request.action) {
                case 'cookies.getCount': {
                    const { url } = request;
                    const storeId = await resolveStoreId();
                    const cookies = await chrome.cookies.getAll({ url, storeId });
                    sendResponse({ success: true, count: cookies.length });
                    break;
                }
                case 'cookies.getAll': {
                    const { url } = request;
                    const storeId = await resolveStoreId();
                    const list = await chrome.cookies.getAll({ url, storeId });
                    const cookies = list.map(c => ({
                        name: c.name,
                        value: c.value,
                        domain: c.domain,
                        path: c.path,
                        secure: c.secure,
                        httpOnly: c.httpOnly,
                        expirationDate: c.expirationDate
                    }));
                    sendResponse({ success: true, cookies });
                    break;
                }
                case 'cookies.setItem': {
                    const { url, name, value, domain, path, secure, httpOnly, expirationDate } = request;
                    const storeId = await resolveStoreId();
                    let computedUrl = url;
                    try {
                        const current = new URL(url);
                        const useDomain = domain ? (domain.startsWith('.') ? domain.substring(1) : domain) : current.hostname;
                        const scheme = secure ? 'https' : (current.protocol.replace(':', '') || 'https');
                        const usePath = path || '/';
                        computedUrl = `${scheme}://${useDomain}${usePath}`;
                    } catch (_) {}
                    await chrome.cookies.set({ url: computedUrl, name, value, domain, path, secure, httpOnly, expirationDate, storeId });
                    sendResponse({ success: true });
                    break;
                }
                case 'cookies.deleteItem': {
                    const { url, name, domain, path, secure } = request;
                    const storeId = await resolveStoreId();
                    let computedUrl = url;
                    try {
                        const current = new URL(url);
                        const useDomain = domain ? (domain.startsWith('.') ? domain.substring(1) : domain) : current.hostname;
                        const scheme = secure ? 'https' : (current.protocol.replace(':', '') || 'https');
                        const usePath = path || '/';
                        computedUrl = `${scheme}://${useDomain}${usePath}`;
                    } catch (_) {}
                    await chrome.cookies.remove({ url: computedUrl, name, storeId });
                    sendResponse({ success: true });
                    break;
                }
                case 'cookies.clearAll': {
                    const { url } = request;
                    const storeId = await resolveStoreId();
                    const cookies = await chrome.cookies.getAll({ url, storeId });
                    await Promise.all(cookies.map(c => chrome.cookies.remove({ url, name: c.name, storeId })));
                    sendResponse({ success: true });
                    break;
                }
                case 'cookies.setMany': {
                    const { url, data } = request;
                    // Normalize to array of {name, value, domain, path, secure, httpOnly, expirationDate}
                    const items = Array.isArray(data)
                        ? data
                        : Object.entries(data || {}).map(([name, cookieData]) => ({ name, ...(cookieData || {}) }));
                    for (const item of items) {
                        const { name, value, domain, path, secure, httpOnly, expirationDate } = item;
                        // Compute a suitable URL for the cookie domain/path
                        let computedUrl = url;
                        try {
                            const current = new URL(url);
                            const useDomain = domain
                                ? (domain.startsWith('.') ? domain.substring(1) : domain)
                                : current.hostname;
                            const scheme = secure ? 'https' : (current.protocol.replace(':', '') || 'https');
                            const usePath = path || '/';
                            computedUrl = `${scheme}://${useDomain}${usePath}`;
                        } catch (_) {
                            // fallback to provided url
                        }

                        const storeId = await resolveStoreId();
                        const details = {
                            url: computedUrl,
                            name,
                            value,
                            domain,
                            path,
                            secure,
                            httpOnly,
                            expirationDate,
                            storeId
                        };
                        Object.keys(details).forEach(k => {
                            if (details[k] === undefined || details[k] === null) delete details[k];
                        });
                        await chrome.cookies.set(details);
                    }
                    sendResponse({ success: true });
                    break;
                }
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Background error:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // keep port open for async response
});
