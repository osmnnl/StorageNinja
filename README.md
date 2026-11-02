# StorageNinja - Chrome Extension

<div align="center">
  <img src="icons/icon.png" alt="StorageNinja" width="128" height="128">
  <h3>Storage Management Tool for Chrome Browser</h3>
  <p>Easily manage Local Storage, Session Storage, and Cookies</p>
  
  <p>
    <a href="https://chromewebstore.google.com/detail/storage-ninja/kenpefhgbcjkofomcfajmhmilhkfdedp" target="_blank">
      <img src="https://img.shields.io/badge/🚀_Install-Chrome_Web_Store-green?style=for-the-badge&logo=google-chrome" alt="Install from Chrome Web Store">
    </a>
    <a href="https://osmnnl.github.io/StorageNinja/" target="_blank">
      <img src="https://img.shields.io/badge/🌐_Visit-Website-blue?style=for-the-badge&logo=github-pages" alt="Visit Website">
    </a>
    <a href="https://github.com/osmnnl/StorageNinja" target="_blank">
      <img src="https://img.shields.io/badge/⭐_Star-Repository-yellow?style=for-the-badge&logo=github" alt="Star Repository">
    </a>
  </p>
  
  <p>
    <strong>🚀 <a href="https://chromewebstore.google.com/detail/storage-ninja/kenpefhgbcjkofomcfajmhmilhkfdedp" target="_blank">Install Now from Chrome Web Store</a></strong>
  </p>
</div>

## 📋 Features

- **One-click access token**: Finds the page's JWT or access token in Local Storage, Session Storage or cookies (nested JSON such as OIDC user objects included), shows its subject and expiry, and copies it raw or as `Bearer …`. You can pin the right source per site.
- **Local & Session Storage**: View, search, edit, copy, paste (merge or replace), import and export as JSON. JSON values are pretty-printed, JWTs are decoded.
- **Cookies**: Every attribute is kept on copy → paste and edit: `SameSite`, `HttpOnly`, `Secure`, host-only, path, expiry and partitioned (CHIPS) cookies. Cookies pasted from another domain (e.g. production → localhost) are moved onto the current site.
- **IndexedDB & Cache Storage**: Browse databases, object stores and records; export, clear or delete them. List and delete cached requests.
- **Snapshots**: Save a site's Local Storage, Session Storage and cookies under a name and restore it later, e.g. to switch between test users.
- **Right-click menu**: Copy the token, copy or paste any storage, save or restore a snapshot, clear everything, without opening the popup.
- **Keyboard shortcuts**: `Alt+Shift+S` opens StorageNinja, `Alt+Shift+T` copies the access token (change them at `chrome://extensions/shortcuts`).
- **DevTools panel**: The same tools in a "StorageNinja" tab inside Chrome DevTools.
- **iframes**: Pick a frame to see its own Local Storage, Session Storage, IndexedDB and Cache Storage.
- **Clear all & reload**: Deletes the site's storage, cookies, IndexedDB, Cache Storage, service workers and HTTP cache, then reloads.
- **Light & dark theme**, follows the system by default.

## 🚀 Installation

### Install from Chrome Web Store

**[👉 Install StorageNinja](https://chromewebstore.google.com/detail/storage-ninja/kenpefhgbcjkofomcfajmhmilhkfdedp)**

### Manual Installation (Developer Mode)

1. Clone the repository: `git clone https://github.com/osmnnl/StorageNinja.git`
2. Go to `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the project folder

## 📖 Usage

### Popup

Click the StorageNinja icon (or press `Alt+Shift+S`):

- **Access token** card: copy the detected token, or click the source to choose another value and pin it for the site.
- **Storage** rows: copy 📋, paste 📥 (you choose merge or replace), clear 🗑️ and open details ›.
- **Snapshots**: *Save current*, then *Restore* whenever you need that state again.

### Details

- Tabs for Local, Session, Cookies, IndexedDB and Cache.
- Filter by key or value, click a row to edit it, add new items.
- Export to / import from a `.json` file. In the popup, import opens the view in a full tab so the file picker does not close it.

### Copy formats

| What | Format |
| ---- | ------ |
| Local / Session Storage | `{ "key": "value", ... }` |
| Cookies | `[{ "name", "value", "domain", "hostOnly", "path", "secure", "httpOnly", "sameSite", "session", "expirationDate", "partitionKey" }]` |
| Copy all (context menu) | `{ "$storageNinja": 2, "localStorage": {...}, "sessionStorage": {...}, "cookies": [...] }` |

A "copy all" bundle can be pasted into any single storage; the matching part is used. The cookie format of version 1.x is still accepted.

## ⚙️ Technical Details

### File Structure

```
StorageNinja/
├── manifest.json            # Manifest V3 configuration
├── background.js            # Service worker: operation router, context menu, shortcuts
├── popup.html               # Toolbar popup
├── panel.html               # DevTools panel and full-tab view
├── devtools.html/.js        # Registers the DevTools panel
├── offscreen.html/.js       # Clipboard for the context menu and shortcuts
├── src/core/                # Storage, cookies, IndexedDB, Cache, token detection, snapshots
├── src/ui/                  # Shared UI (vanilla JS + CSS, inline SVG icons)
└── icons/
```

No remote code: there is no CDN, framework or build step. Everything runs from the extension package, as Manifest V3 requires.

### Permissions

| Permission | Why |
| ---------- | --- |
| `host_permissions: <all_urls>` | Chrome's `cookies` API only works for sites the extension has host access to; `activeTab` is not enough for cookies. Used only for the page you work on. |
| `cookies` | Read, edit and delete the current site's cookies |
| `scripting` | Read and change the page's Local Storage, Session Storage, IndexedDB and Cache Storage |
| `activeTab` | Access the tab you invoke the extension on |
| `contextMenus` | Right-click menu |
| `browsingData` | "Clear all & reload" for the current site |
| `clipboardRead`, `clipboardWrite` | Copy and paste |
| `offscreen` | Clipboard access from the context menu and shortcuts |
| `storage`, `unlimitedStorage` | Snapshots and settings, stored locally |

## 🔒 Security

- All data is processed locally; nothing is sent to any server
- Snapshots and settings stay in the extension's local storage on your device
- No remote scripts, no analytics
- Destructive actions (clear, replace, restore) ask for confirmation

## 🛠️ Development

### Requirements

- Chrome/Chromium browser
- Basic HTML/CSS/JavaScript knowledge

### Running in Development Mode

1. Clone the project
2. Load via "Load unpacked" from `chrome://extensions/` page
3. Click "Reload" button after making changes

### Debug

- Background logs: "Inspect views: service worker" on `chrome://extensions`
- In the service worker console every operation can be called directly, e.g. `await storageNinja.runOp('summary', { tabId })`
- Popup: right-click the popup → Inspect

## 📝 License

This project is released under the [MIT License](LICENSE).

## 🤝 Contributing

1. Fork this repo
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -am 'New feature: description'`)
4. Push your branch (`git push origin feature/new-feature`)
5. Create a Pull Request

## 🐛 Bug Reports

Use the [Issues](https://github.com/osmnnl/StorageNinja/issues) page for bugs or suggestions.

## 📞 Contact

- **Developer**: [GitHub Profile](https://github.com/osmnnl)
- **Email**: osmnnldev@gmail.com

---

<div align="center">
  <p>⭐ Don't forget to star the project if you liked it!</p>
</div>
