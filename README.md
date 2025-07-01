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

- **Local Storage Management**: View, copy, paste, and clear local storage data on a per-page basis
- **Session Storage Management**: Manage session storage data with full control
- **Cookie Management**: Manage cookies with detailed attributes
- **JSON Format**: Copy/paste operations for all data in JSON format
- **Detailed View**: Manage key-value pairs individually for each storage type
- **Modern Interface**: User-friendly interface designed with Tailwind CSS
- **Safe Operations**: Secure data deletion with confirmation prompts
- **Real-time**: Instant data count display

## 🚀 Installation

### Install from Chrome Web Store
🎉 **StorageNinja is now live on Chrome Web Store!**

**[👉 Install StorageNinja](https://chromewebstore.google.com/detail/storage-ninja/kenpefhgbcjkofomcfajmhmilhkfdedp)**

Simply click the link above and hit "Add to Chrome" to install the extension instantly.

### Manual Installation (Developer Mode)

1. **Download Files**
   ```bash
   git clone https://github.com/osmnnl/StorageNinja.git
cd StorageNinja
   ```

2. **Prepare Icon Files**
   Add the following files to the `icons/` folder:
   - `icon16.png` (16x16 pixels)
   - `icon48.png` (48x48 pixels)
   - `icon128.png` (128x128 pixels)

3. **Enable Developer Mode in Chrome**
   - Go to `chrome://extensions/` in Chrome
   - Turn on "Developer mode" switch in the top right corner

4. **Load the Extension**
   - Click "Load unpacked" button
   - Select the project folder
   - StorageNinja extension will be loaded

## 📖 Usage

### Main Interface

After installing the extension, click the StorageNinja icon in the browser toolbar.

#### Storage Sections
- 🟢 **Local Storage**: Persistent local storage
- 🟡 **Session Storage**: Session-based storage
- 🟠 **Cookies**: HTTP cookies

#### Main Operations
Four main operations are available for each storage type:

| Icon | Operation | Description |
|------|-----------|-------------|
| 📋 | **Copy** | Copies all data to clipboard in JSON format |
| 📥 | **Paste** | Loads JSON data from clipboard to storage |
| 🗑️ | **Clear** | Deletes all data (asks for confirmation) |
| 👁️ | **Details** | Shows key-value pairs in detail |

### Detail View

When you click the "Details" button, on the opened page:

- **View all key-value pairs** in a list
- **Add new items** (key-value)
- **For each item individually**:
  - Copy (only that item)
  - Paste (update that item's value)
  - Delete (only that item)

## ⚙️ Technical Details

### File Structure
```
storage-ninja/
├── manifest.json          # Extension configuration
├── popup.html             # Main popup interface
├── popup.js               # Main popup JavaScript
├── content.js             # Content script
├── background.js          # Background service worker
├── styles.css             # CSS styles
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

### Technologies
- **Manifest V3** - Modern Chrome Extension standard
- **HTML5** - Interface structure
- **Tailwind CSS** - Style framework
- **Font Awesome** - Icons
- **Vanilla JavaScript** - Functionality
- **Chrome APIs** - Storage, cookies, scripting APIs

### Permissions
The extension uses the following minimal permissions for enhanced security:
- `activeTab` - Access only the currently active tab (no broad website access)
- `storage` - Chrome storage API for extension settings
- `cookies` - Cookie management on active tab only
- `scripting` - Dynamic script injection into active tab when needed
- `clipboardRead` - Read clipboard data for paste functionality
- `clipboardWrite` - Write to clipboard for copy functionality

**Note**: StorageNinja uses only `activeTab` permission for maximum security - no broad host permissions required!

## 🔒 Security

- All data is processed locally only
- No data is sent to external servers
- Content script is injected only when necessary
- Confirmation prompts for sensitive operations

## 🛠️ Development

### Requirements
- Chrome/Chromium browser
- Basic HTML/CSS/JavaScript knowledge

### Running in Development Mode
1. Clone the project
2. Load via "Load unpacked" from `chrome://extensions/` page
3. Click "Reload" button after making changes

### Debug
- View console logs in `Developer Tools > Console`
- Background script logs via "Inspect" link on extension page
- Popup debug with `F12` key while popup is open

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
