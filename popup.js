// StorageNinja - Main Popup Script

class StorageNinja {
    constructor() {
        this.currentTab = null;
        this.currentDetailStorage = null; // To keep track of which detail view is open
        this.init();
    }

    async init() {
        this.setPopupWidth(300); // Set initial width
        await this.getCurrentTab();

        // Check for restricted pages
        if (!this.currentTab || this.isRestrictedUrl(this.currentTab.url)) {
            this.handleRestrictedPage();
            return;
        }

        this.setupEventListeners();
        this.loadStorageCounts();
    }

    isRestrictedUrl(url) {
        if (!url) return true;
        const restrictedProtocols = [
            'chrome://',
            'chrome-extension://',
            'chrome-error://',
            'about:',
            'data:',
            'javascript:'
        ];
        return restrictedProtocols.some(protocol => url.startsWith(protocol)) ||
            url.includes('chromewebstore.google.com');
    }

    handleRestrictedPage() {
        // Disable all buttons and show a message
        document.querySelectorAll('button').forEach(button => {
            button.disabled = true;
            button.classList.add('opacity-50', 'cursor-not-allowed');
        });

        document.getElementById('localStorage-count').textContent = 'N/A';
        document.getElementById('sessionStorage-count').textContent = 'N/A';
        document.getElementById('cookies-count').textContent = 'N/A';

        this.showMessage('Cannot access storage on this special page.', 'info');
    }

    async getCurrentTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTab = tab;
        } catch (error) {
            console.error('Failed to get tab info:', error);
            this.currentTab = null;
        }
    }

    setupEventListeners() {
        // Main View listeners
        document.getElementById('localStorage-copy').addEventListener('click', () => this.copyStorage('localStorage'));
        document.getElementById('localStorage-paste').addEventListener('click', () => this.pasteStorage('localStorage'));
        document.getElementById('localStorage-clear').addEventListener('click', () => this.clearStorage('localStorage'));
        document.getElementById('localStorage-details').addEventListener('click', () => this.showDetailsView('localStorage'));

        document.getElementById('sessionStorage-copy').addEventListener('click', () => this.copyStorage('sessionStorage'));
        document.getElementById('sessionStorage-paste').addEventListener('click', () => this.pasteStorage('sessionStorage'));
        document.getElementById('sessionStorage-clear').addEventListener('click', () => this.clearStorage('sessionStorage'));
        document.getElementById('sessionStorage-details').addEventListener('click', () => this.showDetailsView('sessionStorage'));

        document.getElementById('cookies-copy').addEventListener('click', () => this.copyStorage('cookies'));
        document.getElementById('cookies-paste').addEventListener('click', () => this.pasteStorage('cookies'));
        document.getElementById('cookies-clear').addEventListener('click', () => this.clearStorage('cookies'));
        document.getElementById('cookies-details').addEventListener('click', () => this.showDetailsView('cookies'));

        // Access token
        document.getElementById('token-copy').addEventListener('click', () => this.copyAccessToken());

        // All Clear & Refresh
        document.getElementById('all-clear-refresh').addEventListener('click', () => this.allClearAndRefresh());

        // Details View listeners
        document.getElementById('back-to-main').addEventListener('click', () => this.showMainView());
    }

    async loadStorageCounts() {
        try {
            // Get storage data from content script
            const response = await this.sendToContentScript({ action: 'getStorageCounts' });

            if (response) {
                document.getElementById('localStorage-count').textContent = `${response.localStorage || 0}`;
                document.getElementById('sessionStorage-count').textContent = `${response.sessionStorage || 0}`;
                document.getElementById('cookies-count').textContent = `${response.cookies || 0}`;
            }
        } catch (error) {
            console.error('Error loading storage counts:', error);
            this.showMessage('Error occurred while loading storage information', 'error');
        }
    }

    async copyStorage(storageType) {
        try {
            const response = await this.sendToContentScript({
                action: 'getStorage',
                storageType
            });

            if (response && response.data) {
                const data = response.data;
                const dataCount = (storageType === 'cookies' && Array.isArray(data))
                    ? data.length
                    : Object.keys(data).length;
                await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                this.showMessage(`${this.getStorageDisplayName(storageType)} copied (${dataCount} items)`, 'success');
            } else {
                this.showMessage('No data found to copy', 'info');
            }
        } catch (error) {
            console.error('Copy error:', error);
            this.showMessage('Copy operation failed', 'error');
        }
    }

    async pasteStorage(storageType) {
        try {
            const clipboardText = await navigator.clipboard.readText();

            if (!clipboardText.trim()) {
                this.showMessage('No data found in clipboard', 'error');
                return;
            }

            let data;
            try {
                data = JSON.parse(clipboardText);
            } catch (parseError) {
                this.showMessage('Invalid JSON format', 'error');
                return;
            }

            const response = await this.sendToContentScript({
                action: 'setStorage',
                storageType,
                data
            });

            if (response && response.success) {
                const dataCount = Object.keys(data).length;
                this.showMessage(`${this.getStorageDisplayName(storageType)} successfully pasted (${dataCount} items)`, 'success');
                this.loadStorageCounts(); // Refresh counts
            } else {
                // DETAILED ERROR: Show the specific error message from the content script
                const errorMessage = response && response.error ? response.error : 'Unknown paste error occurred.';
                this.showMessage(errorMessage, 'error');
            }
        } catch (error) {
            console.error('Paste error:', error);
            // DETAILED ERROR: Show the error from the exception
            this.showMessage(error.message || 'An error occurred during paste operation.', 'error');
        }
    }

    async clearStorage(storageType) {
        if (!confirm(`Are you sure you want to delete all data in ${this.getStorageDisplayName(storageType)}?`)) {
            return;
        }

        try {
            const response = await this.sendToContentScript({
                action: 'clearStorage',
                storageType
            });

            if (response && response.success) {
                this.showMessage(`${this.getStorageDisplayName(storageType)} successfully cleared`, 'success');
                this.loadStorageCounts(); // Refresh counts
            } else {
                // DETAILED ERROR: Show the specific error message from the content script
                const errorMessage = response && response.error ? response.error : 'Clear operation failed.';
                this.showMessage(errorMessage, 'error');
            }
        } catch (error) {
            console.error('Clear error:', error);
            this.showMessage(error.message || 'Clear operation failed.', 'error');
        }
    }

    // VIEW MANAGEMENT
    showMainView() {
        this.setPopupWidth(300); // Shrink back to 300px
        document.getElementById('main-view').style.display = 'block';
        document.getElementById('details-view').style.display = 'none';

        // Clear previous details
        document.getElementById('items-list').innerHTML = '';
        document.getElementById('add-item-form').innerHTML = '';
        this.currentDetailStorage = null;
        this.loadStorageCounts();
    }

    async showDetailsView(storageType) {
        this.setPopupWidth(600); // Expand to 600px
        this.currentDetailStorage = storageType;

        document.getElementById('main-view').style.display = 'none';
        document.getElementById('details-view').style.display = 'block';

        const title = `${this.getStorageDisplayName(storageType)} Details`;
        document.getElementById('details-title').textContent = title;

        await this.renderDetails();
    }

    // DETAILS VIEW RENDERING
    async renderDetails() {
        const itemsList = document.getElementById('items-list');
        const addItemForm = document.getElementById('add-item-form');
        itemsList.innerHTML = '<div class="text-center p-4">Loading...</div>';
        addItemForm.innerHTML = '';

        try {
            const response = await this.sendToContentScript({ action: 'getStorage', storageType: this.currentDetailStorage });

            if (response && response.success) {
                itemsList.innerHTML = '';
                const data = response.data;
                if (this.currentDetailStorage === 'cookies') {
                    const cookies = Array.isArray(data) ? data : [];
                    if (cookies.length === 0) {
                        itemsList.innerHTML = `<div class="text-center p-4 text-gray-500">Empty</div>`;
                    } else {
                        // Header row (grid)
                        const header = document.createElement('div');
                        header.className = 'cookie-grid cookie-header';
                        header.innerHTML = `
                            <div class="cookie-cell">Name</div>
                            <div class="cookie-cell">Value</div>
                            <div class="cookie-cell">Domain</div>
                            <div class="cookie-cell">Path</div>
                            <div class="cookie-cell">Secure</div>
                            <div class="cookie-cell">HttpOnly</div>
                            <div class="cookie-cell">Expires</div>
                            <div class="cookie-cell cookie-actions">Actions</div>
                        `;
                        itemsList.appendChild(header);

                        cookies.forEach(cookie => {
                            const row = this.createCookieRow(cookie);
                            itemsList.appendChild(row);
                        });
                    }
                    this.renderAddCookieForm();
                } else {
                    const keys = Object.keys(data);
                    if (keys.length === 0) {
                        itemsList.innerHTML = `<div class="text-center p-4 text-gray-500">Empty</div>`;
                    } else {
                        keys.forEach(key => {
                            const itemEl = this.createItemElement(this.currentDetailStorage, key, data[key]);
                            itemsList.appendChild(itemEl);
                        });
                    }
                    // Add the "Add Item" form
                    this.renderAddItemForm();
                }

            } else {
                throw new Error(response.error || 'Could not retrieve data');
            }
        } catch (error) {
            itemsList.innerHTML = `<div class="status-error p-4">Error: ${error.message}</div>`;
        }
    }

    createCookieRow(cookie) {
        const row = document.createElement('div');
        row.className = 'cookie-grid';

        const valueString = typeof cookie.value === 'object' && cookie.value !== null ? JSON.stringify(cookie.value) : String(cookie.value);

        const nameEl = document.createElement('div');
        nameEl.className = 'cookie-cell';
        nameEl.textContent = cookie.name;
        nameEl.title = cookie.name;

        const valueEl = document.createElement('div');
        valueEl.className = 'cookie-cell cookie-value-cell';
        valueEl.textContent = valueString;
        valueEl.title = valueString;
        valueEl.addEventListener('click', () => {
            this.showValueModal(cookie.name, valueString);
        });

        const domainEl = document.createElement('div');
        domainEl.className = 'cookie-cell';
        domainEl.textContent = cookie.domain || '';
        domainEl.title = cookie.domain || '';

        const pathEl = document.createElement('div');
        pathEl.className = 'cookie-cell';
        pathEl.textContent = cookie.path || '/';

        const secureEl = document.createElement('div');
        secureEl.className = 'cookie-cell';
        secureEl.textContent = cookie.secure ? 'Yes' : 'No';

        const httpOnlyEl = document.createElement('div');
        httpOnlyEl.className = 'cookie-cell';
        httpOnlyEl.textContent = cookie.httpOnly ? 'Yes' : 'No';

        const expEl = document.createElement('div');
        expEl.className = 'cookie-cell';
        expEl.textContent = cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleString() : '';

        // Actions container as sticky last column
        const actions = document.createElement('div');
        actions.className = 'cookie-actions';

        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.className = 'item-action-btn copy-btn';
        copyBtn.title = 'Copy Cookie JSON';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(JSON.stringify(cookie, null, 2));
            this.showMessage(`'${cookie.name}' cookie copied`, 'success');
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.className = 'item-action-btn clear-btn';
        deleteBtn.title = 'Delete Cookie';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Delete cookie '${cookie.name}' for ${cookie.domain}${cookie.path || '/'}?`)) {
                await this.deleteItem('cookies', cookie.name, {
                    domain: cookie.domain,
                    path: cookie.path,
                    secure: cookie.secure
                });
            }
        });

        actions.appendChild(copyBtn);
        actions.appendChild(deleteBtn);

        // Append cells
        row.appendChild(nameEl);
        row.appendChild(valueEl);
        row.appendChild(domainEl);
        row.appendChild(pathEl);
        row.appendChild(secureEl);
        row.appendChild(httpOnlyEl);
        row.appendChild(expEl);
        row.appendChild(actions);
        return row;
    }

    showValueModal(title, text) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal-content';
        modal.innerHTML = `
            <div class="modal-title">${this.escapeHtml(title)}</div>
            <div class="modal-body">${this.escapeHtml(text)}</div>
            <div class="modal-actions">
                <button id="modal-copy" class="btn">Copy</button>
                <button id="modal-close" class="btn btn-primary">Close</button>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) document.body.removeChild(overlay);
        });
        modal.querySelector('#modal-close').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        modal.querySelector('#modal-copy').addEventListener('click', async () => {
            await navigator.clipboard.writeText(text);
            this.showMessage('Value copied', 'success');
        });
    }

    escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    createItemElement(storageType, key, value) {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'storage-item-row';

        const keyValueContainer = document.createElement('div');
        keyValueContainer.className = 'item-key-value-container';

        const keyText = document.createElement('div');
        keyText.className = 'key-text';
        keyText.textContent = key;
        keyText.title = key;

        const valueString = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
        const valueText = document.createElement('div');
        valueText.className = 'value-text';
        valueText.textContent = valueString;
        valueText.title = valueString;

        keyValueContainer.appendChild(keyText);
        keyValueContainer.appendChild(valueText);

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'item-actions';

        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.className = 'item-action-btn copy-btn';
        copyBtn.title = 'Copy Value';
        copyBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(valueString);
            this.showMessage(`'${key}' value copied to clipboard`, 'success');
        });

        // Paste Button
        const pasteBtn = document.createElement('button');
        pasteBtn.innerHTML = '<i class="fas fa-paste"></i>';
        pasteBtn.className = 'item-action-btn paste-btn';
        pasteBtn.title = 'Paste Value';
        pasteBtn.addEventListener('click', async () => {
            try {
                const clipboardText = await navigator.clipboard.readText();
                await this.setItem(storageType, key, clipboardText);
            } catch (error) {
                this.showMessage(`Paste error: ${error.message}`, 'error');
            }
        });

        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.className = 'item-action-btn clear-btn';
        deleteBtn.title = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            if (confirm(`Are you sure you want to delete the '${key}' key?`)) {
                await this.deleteItem(storageType, key);
            }
        });

        actionsContainer.appendChild(copyBtn);
        actionsContainer.appendChild(pasteBtn);
        actionsContainer.appendChild(deleteBtn);

        itemContainer.appendChild(keyValueContainer);
        itemContainer.appendChild(actionsContainer);

        return itemContainer;
    }

    renderAddItemForm() {
        const formContainer = document.getElementById('add-item-form');
        formContainer.innerHTML = `
            <div class="add-item-container">
                <input id="add-key-input" class="modern-input" placeholder="Key">
                <input id="add-value-input" class="modern-input" placeholder="Value (can be JSON)">
                <button id="add-item-btn" class="add-button">Add</button>
            </div>
        `;

        document.getElementById('add-item-btn').addEventListener('click', async () => {
            const key = document.getElementById('add-key-input').value;
            const value = document.getElementById('add-value-input').value;
            if (key && value) {
                await this.setItem(this.currentDetailStorage, key, value);
            } else {
                this.showMessage('Key and value cannot be empty', 'error');
            }
        });
    }

    renderAddCookieForm() {
        const formContainer = document.getElementById('add-item-form');
        formContainer.innerHTML = `
            <div class="add-item-container">
                <input id="cookie-name" class="modern-input" placeholder="Name">
                <input id="cookie-value" class="modern-input" placeholder="Value">
                <input id="cookie-domain" class="modern-input" placeholder="Domain (e.g. .example.com)">
                <input id="cookie-path" class="modern-input" placeholder="Path (default '/')">
                <input id="cookie-exp" class="modern-input" placeholder="Expiration (Unix seconds or empty)">
                <label style="display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" id="cookie-secure"> Secure
                </label>
                <label style="display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" id="cookie-httponly"> HttpOnly
                </label>
                <button id="add-cookie-btn" class="add-button">Add Cookie</button>
            </div>
        `;

        document.getElementById('add-cookie-btn').addEventListener('click', async () => {
            const name = document.getElementById('cookie-name').value.trim();
            const value = document.getElementById('cookie-value').value;
            const domain = document.getElementById('cookie-domain').value.trim();
            const path = document.getElementById('cookie-path').value.trim() || '/';
            const expStr = document.getElementById('cookie-exp').value.trim();
            const secure = !!document.getElementById('cookie-secure').checked;
            const httpOnly = !!document.getElementById('cookie-httponly').checked;
            const expirationDate = expStr ? Number(expStr) : undefined;

            if (!name) {
                this.showMessage('Cookie name is required', 'error');
                return;
            }

            await this.setItem('cookies', name, value, { domain, path, secure, httpOnly, expirationDate });
        });
    }

    // NEW CRUD Functions for Details View
    async setItem(storageType, key, value, extra = undefined) {
        try {
            await this.sendToContentScript({ action: 'setStorageItem', storageType, key, value, extra });
            this.showMessage(`'${key}' successfully added/updated`, 'success');
            await this.renderDetails(); // Refresh list
        } catch (error) {
            this.showMessage(`Add/update error: ${error.message}`, 'error');
        }
    }

    async deleteItem(storageType, key, extra = undefined) {
        try {
            await this.sendToContentScript({ action: 'deleteStorageItem', storageType, key, extra });
            this.showMessage(`'${key}' successfully deleted`, 'success');
            await this.renderDetails(); // Refresh list
        } catch (error) {
            this.showMessage(`Delete error: ${error.message}`, 'error');
        }
    }

    async sendToContentScript(message) {
        try {
            const response = await chrome.tabs.sendMessage(this.currentTab.id, message);
            return response;
        } catch (error) {
            // If content script is not loaded, inject it
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: this.currentTab.id },
                    files: ['content.js']
                });

                // Try again after injection
                return await chrome.tabs.sendMessage(this.currentTab.id, message);
            } catch (injectionError) {
                console.error('Content script injection failed:', injectionError);
                throw injectionError;
            }
        }
    }

    // ---- Access token ----
    // Copies only the raw token. Copying the whole storage as JSON escapes
    // tokens that live inside JSON strings (e.g. "{\"access_token\":\"eyJ...\"}"),
    // which makes them hard to read and easy to break when pasted elsewhere.

    async copyAccessToken() {
        try {
            const tokens = await this.findAccessTokens();
            const list = document.getElementById('token-list');
            if (tokens.length === 0) {
                list.style.display = 'none';
                this.showMessage('No access token found on this page', 'info');
                return;
            }
            await navigator.clipboard.writeText(tokens[0].value);
            this.showMessage(`Token copied: ${tokens[0].source}`, 'success');
            this.renderTokenList(tokens);
        } catch (error) {
            console.error('Token copy error:', error);
            this.showMessage('Token copy failed', 'error');
        }
    }

    renderTokenList(tokens) {
        const list = document.getElementById('token-list');
        list.textContent = '';
        if (tokens.length < 2) {
            list.style.display = 'none';
            return;
        }
        tokens.slice(0, 6).forEach((t, i) => {
            const row = document.createElement('button');
            row.className = 'token-row' + (i === 0 ? ' active' : '');
            row.title = 'Copy this token';
            const src = document.createElement('span');
            src.className = 'token-src';
            src.textContent = t.source;
            const meta = document.createElement('span');
            meta.className = 'token-meta';
            meta.textContent = t.meta;
            row.append(src, meta);
            row.addEventListener('click', async () => {
                await navigator.clipboard.writeText(t.value);
                list.querySelectorAll('.token-row').forEach(r => r.classList.remove('active'));
                row.classList.add('active');
                this.showMessage(`Token copied: ${t.source}`, 'success');
            });
            list.appendChild(row);
        });
        list.style.display = 'block';
    }

    async findAccessTokens() {
        const sources = [
            ['localStorage', 'Local'],
            ['sessionStorage', 'Session'],
            ['cookies', 'Cookie']
        ];
        const found = new Map();

        for (const [type, label] of sources) {
            const response = await this.sendToContentScript({ action: 'getStorage', storageType: type });
            if (!response || !response.data) continue;
            const entries = Array.isArray(response.data)
                ? response.data.map(c => [c.name, c.value])
                : Object.entries(response.data);
            for (const [key, value] of entries) {
                this.collectTokens(value, [label, key], found, 0);
            }
        }

        return [...found.values()].sort((a, b) => b.score - a.score);
    }

    collectTokens(value, path, found, depth) {
        if (depth > 8 || value === null || value === undefined) return;

        if (typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
                this.collectTokens(v, path.concat(k), found, depth + 1);
            }
            return;
        }
        if (typeof value !== 'string') return;

        let text = value.trim();
        if (text.includes('%')) {
            try { text = decodeURIComponent(text); } catch (_) { /* keep raw */ }
        }
        text = text.replace(/^Bearer\s+/i, '').replace(/^"+|"+$/g, '');

        // JSON inside a string (possibly several levels deep)
        if (/^[[{"]/.test(text)) {
            try {
                this.collectTokens(JSON.parse(text), path, found, depth + 1);
                return;
            } catch (_) { /* not JSON */ }
        }

        const keyPath = path.slice(1).join(' › ');
        const lastKey = String(path[path.length - 1]);
        const payload = this.decodeJwtPayload(text);
        const isOpaqueAccess = !payload && /access[_-]?token/i.test(lastKey) && /^[\w\-.~+/=]{16,}$/.test(text);
        if (!payload && !isOpaqueAccess) return;
        if (found.has(text)) return;

        let score = 0;
        const now = Date.now() / 1000;
        const keys = path.join(' ');
        if (/access/i.test(keys)) score += 50;
        if (/id[_-]?token/i.test(keys)) score -= 20;
        if (/refresh/i.test(keys)) score -= 40;

        const meta = [];
        if (payload) {
            if (payload.scope || payload.scp || payload.aud) score += 5;
            if (typeof payload.exp === 'number') {
                const mins = Math.round((payload.exp - now) / 60);
                if (mins > 0) { score += 20; meta.push(`expires in ${this.formatMinutes(mins)}`); }
                else { score -= 30; meta.push(`expired ${this.formatMinutes(-mins)} ago`); }
            }
        } else {
            meta.push('opaque');
        }

        found.set(text, {
            value: text,
            score,
            source: `${path[0]} › ${keyPath}`,
            meta: meta.join(' · ') || 'JWT'
        });
    }

    decodeJwtPayload(text) {
        if (!/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*$/.test(text)) return null;
        try {
            const decode = part => {
                const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
                const json = decodeURIComponent(atob(b64 + '='.repeat((4 - b64.length % 4) % 4))
                    .split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
                return JSON.parse(json);
            };
            const [header, payload] = text.split('.');
            if (!decode(header).alg) return null;
            const p = decode(payload);
            return p && typeof p === 'object' ? p : null;
        } catch (_) {
            return null;
        }
    }

    formatMinutes(mins) {
        if (mins < 60) return `${mins} min`;
        if (mins < 60 * 48) return `${Math.round(mins / 60)} h`;
        return `${Math.round(mins / 1440)} d`;
    }

    getStorageDisplayName(storageType) {
        const names = {
            localStorage: 'Local Storage',
            sessionStorage: 'Session Storage',
            cookies: 'Cookies'
        };
        return names[storageType] || storageType;
    }

    showMessage(text, type = 'info') {
        const toastEl = document.getElementById('toast-notification');

        // Clear any existing classes and set new ones
        toastEl.className = `toast-notification toast-${type}`;
        toastEl.textContent = text;

        // Show toast with animation
        requestAnimationFrame(() => {
            toastEl.classList.add('show');
        });

        // Hide toast after 2.5 seconds
        setTimeout(() => {
            toastEl.classList.remove('show');
        }, 2500);
    }

    setPopupWidth(width) {
        const widthPx = `${width}px`;
        document.body.style.width = widthPx;
        document.documentElement.style.width = widthPx; // Also set for HTML tag
    }

    async allClearAndRefresh() {
        if (!confirm('This will clear all Local Storage, Session Storage, Cookies and Cache, and refresh the page. Do you want to continue?')) {
            return;
        }
        try {
            const response = await this.sendToContentScript({ action: 'allClearAndRefresh' });
            if (response && response.success) {
                this.showMessage('All data cleared, refreshing page...', 'success');
                setTimeout(() => {
                    window.close(); // Close popup
                    chrome.tabs.reload(this.currentTab.id);
                }, 800);
            } else {
                this.showMessage('Clear operation failed.', 'error');
            }
        } catch (error) {
            this.showMessage('An error occurred: ' + error.message, 'error');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new StorageNinja();
}); 