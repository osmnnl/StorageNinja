// StorageNinja - Content Script

class StorageManager {
    constructor() {
        this.setupMessageListener();
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep the message channel open for async responses
        });
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'getStorageCounts':
                    sendResponse(await this.getStorageCounts());
                    break;
                case 'getStorage':
                    sendResponse(await this.getStorage(request.storageType));
                    break;
                case 'setStorage':
                    sendResponse(await this.setStorage(request.storageType, request.data));
                    break;
                case 'clearStorage':
                    sendResponse(await this.clearStorage(request.storageType));
                    break;
                case 'setStorageItem':
                    sendResponse(await this.setStorageItem(request.storageType, request.key, request.value, request.extra));
                    break;
                case 'deleteStorageItem':
                    sendResponse(await this.deleteStorageItem(request.storageType, request.key, request.extra));
                    break;
                case 'allClearAndRefresh':
                    await this.allClearAndRefresh();
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Content script error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async getStorageCounts() {
        try {
            const counts = {
                localStorage: this.getLocalStorageCount(),
                sessionStorage: this.getSessionStorageCount(),
                cookies: await this.getCookiesCount()
            };
            return counts;
        } catch (error) {
            console.error('Error getting storage counts:', error);
            return { localStorage: 0, sessionStorage: 0, cookies: 0 };
        }
    }

    getLocalStorageCount() {
        try {
            return localStorage.length;
        } catch (error) {
            console.error('Error accessing localStorage:', error);
            return 0;
        }
    }

    getSessionStorageCount() {
        try {
            return sessionStorage.length;
        } catch (error) {
            console.error('Error accessing sessionStorage:', error);
            return 0;
        }
    }

    async getCookiesCount() {
        try {
            const response = await this.callBackground({ action: 'cookies.getCount', url: window.location.href });
            return response && response.success ? (response.count || 0) : 0;
        } catch (error) {
            console.error('Error accessing cookies:', error);
            return 0;
        }
    }

    async getStorage(storageType) {
        try {
            let data = {};

            switch (storageType) {
                case 'localStorage':
                    data = this.getLocalStorageData();
                    break;
                case 'sessionStorage':
                    data = this.getSessionStorageData();
                    break;
                case 'cookies':
                    data = await this.getCookiesData();
                    break;
                default:
                    throw new Error('Invalid storage type');
            }

            return { success: true, data };
        } catch (error) {
            console.error('Error getting storage:', error);
            return { success: false, error: error.message };
        }
    }

    getLocalStorageData() {
        const data = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    data[key] = localStorage.getItem(key);
                }
            }
        } catch (error) {
            console.error('Error reading localStorage:', error);
        }
        return data;
    }

    getSessionStorageData() {
        const data = {};
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key) {
                    data[key] = sessionStorage.getItem(key);
                }
            }
        } catch (error) {
            console.error('Error reading sessionStorage:', error);
        }
        return data;
    }

    async getCookiesData() {
        try {
            const response = await this.callBackground({ action: 'cookies.getAll', url: window.location.href });
            // Return array of cookie objects; fallback to empty array
            return response && response.success ? (response.cookies || []) : [];
        } catch (error) {
            console.error('Error reading cookies:', error);
            return [];
        }
    }

    isValidCookieData(data) {
        // Accept array format: [{ name, value, domain, path, secure, httpOnly, expirationDate }, ...]
        if (Array.isArray(data)) {
            if (data.length === 0) return true;
            const c = data[0] || {};
            return typeof c === 'object' && !!c.name && 'value' in c;
        }
        // Accept object map format: { name: { value, domain, ... } }
        if (typeof data === 'object' && data !== null) {
            const firstValue = Object.values(data)[0];
            return typeof firstValue === 'object' && firstValue !== null && ('value' in firstValue);
        }
        return false;
    }

    async setStorage(storageType, data) {
        try {
            switch (storageType) {
                case 'localStorage':
                    this.setLocalStorageData(data);
                    break;
                case 'sessionStorage':
                    this.setSessionStorageData(data);
                    break;
                case 'cookies':
                    // VALIDATION: Check if the data is in the correct format for cookies
                    if (!this.isValidCookieData(data)) {
                        throw new Error('Clipboard data is not in Cookie format. Please copy valid cookie data.');
                    }
                    await this.setCookiesData(data);
                    break;
                default:
                    throw new Error('Invalid storage type');
            }

            return { success: true };
        } catch (error) {
            console.error('Error setting storage:', error);
            return { success: false, error: error.message };
        }
    }

    setLocalStorageData(data) {
        try {
            localStorage.clear();
            Object.entries(data).forEach(([key, value]) => {
                // If the value is an object, stringify it to prevent "[object Object]".
                const valueToStore = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
                localStorage.setItem(key, valueToStore);
            });
        } catch (error) {
            console.error('Error setting localStorage:', error);
            throw error;
        }
    }

    setSessionStorageData(data) {
        try {
            sessionStorage.clear();
            Object.entries(data).forEach(([key, value]) => {
                // If the value is an object, stringify it.
                const valueToStore = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
                sessionStorage.setItem(key, valueToStore);
            });
        } catch (error) {
            console.error('Error setting sessionStorage:', error);
            throw error;
        }
    }

    async setCookiesData(data) {
        try {
            const response = await this.callBackground({ action: 'cookies.setMany', url: window.location.href, data });
            if (!response || !response.success) {
                throw new Error(response && response.error ? response.error : 'Cookie set failed');
            }
        } catch (error) {
            console.error('Error: Problem occurred while setting cookie.', error, data);
            throw new Error(`Cookie could not be set due to '${error.message}'.`);
        }
    }

    async clearStorage(storageType) {
        try {
            switch (storageType) {
                case 'localStorage':
                    localStorage.clear();
                    break;
                case 'sessionStorage':
                    sessionStorage.clear();
                    break;
                case 'cookies':
                    await this.clearCookies();
                    break;
                default:
                    throw new Error('Invalid storage type');
            }

            return { success: true };
        } catch (error) {
            console.error('Error clearing storage:', error);
            return { success: false, error: error.message };
        }
    }

    async clearCookies() {
        try {
            const response = await this.callBackground({ action: 'cookies.clearAll', url: window.location.href });
            if (!response || !response.success) {
                throw new Error(response && response.error ? response.error : 'Cookie clear failed');
            }
        } catch (error) {
            console.error('Error clearing cookies:', error);
            throw error;
        }
    }

    async setStorageItem(storageType, key, value, extra = {}) {
        try {
            switch (storageType) {
                case 'localStorage':
                    localStorage.setItem(key, value);
                    break;
                case 'sessionStorage':
                    sessionStorage.setItem(key, value);
                    break;
                case 'cookies':
                    await this.callBackground({
                        action: 'cookies.setItem',
                        url: window.location.href,
                        name: key,
                        value: value,
                        domain: extra.domain,
                        path: extra.path,
                        secure: extra.secure,
                        httpOnly: extra.httpOnly,
                        expirationDate: extra.expirationDate
                    });
                    break;
                default:
                    throw new Error('Invalid storage type');
            }

            return { success: true };
        } catch (error) {
            console.error('Error setting storage item:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteStorageItem(storageType, key, extra = {}) {
        try {
            switch (storageType) {
                case 'localStorage':
                    localStorage.removeItem(key);
                    break;
                case 'sessionStorage':
                    sessionStorage.removeItem(key);
                    break;
                case 'cookies':
                    await this.callBackground({
                        action: 'cookies.deleteItem',
                        url: window.location.href,
                        name: key,
                        domain: extra.domain,
                        path: extra.path,
                        secure: extra.secure
                    });
                    break;
                default:
                    throw new Error('Invalid storage type');
            }

            return { success: true };
        } catch (error) {
            console.error('Error deleting storage item:', error);
            return { success: false, error: error.message };
        }
    }

    async allClearAndRefresh() {
        try {
            // Local Storage
            localStorage.clear();
            // Session Storage
            sessionStorage.clear();
            // Cookies
            await this.callBackground({ action: 'cookies.clearAll', url: window.location.href });
            // Cache (Service Worker Cache API)
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
            }
        } catch (error) {
            console.error('All clear & refresh error:', error);
        }
    }

    async callBackground(message) {
        try {
            const response = await chrome.runtime.sendMessage(message);
            return response;
        } catch (e) {
            console.error('Background message failed:', e);
            return { success: false, error: e.message };
        }
    }
}

// Initialize the storage manager
new StorageManager(); 