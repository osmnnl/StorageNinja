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
                const dataCount = Object.keys(response.data).length;
                await navigator.clipboard.writeText(JSON.stringify(response.data, null, 2));
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

            } else {
                throw new Error(response.error || 'Could not retrieve data');
            }
        } catch (error) {
            itemsList.innerHTML = `<div class="status-error p-4">Error: ${error.message}</div>`;
        }
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

    // NEW CRUD Functions for Details View
    async setItem(storageType, key, value) {
        try {
            await this.sendToContentScript({ action: 'setStorageItem', storageType, key, value });
            this.showMessage(`'${key}' successfully added/updated`, 'success');
            await this.renderDetails(); // Refresh list
        } catch (error) {
            this.showMessage(`Add/update error: ${error.message}`, 'error');
        }
    }

    async deleteItem(storageType, key) {
        try {
            await this.sendToContentScript({ action: 'deleteStorageItem', storageType, key });
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