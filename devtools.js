// StorageNinja - registers the DevTools panel for the inspected tab.

chrome.devtools.panels.create(
    'StorageNinja',
    'icons/icon16.png',
    `panel.html?tabId=${chrome.devtools.inspectedWindow.tabId}`
);
