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
    // Handle any background tasks if needed in the future
    return true;
});
