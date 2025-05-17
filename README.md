# Extmark Manager

A browser extension for Chrome and Edge that helps you manage, display, and back up your bookmarks and installed extensions. Easily export your data, switch between tabs, and keep your browsing environment organized and secure.

## Features

- **Bookmark Management:** View, organize, and display your bookmarks directly from the extension popup.
- **Backup & Restore:** Export your bookmarks and extension data for safekeeping or transfer to another device.
- **Extension Display:** See a list of your installed extensions and manage them from the popup.
- **Tab Switcher:** Quickly switch between open tabs for improved productivity.
- **Browser Compatibility:** Works with Chrome and Edge browsers.
- **User-Friendly UI:** Clean and intuitive popup interface with support for light and dark themes.

## Installation

1. **Download or Clone this Repository:**
   ```bash
   git clone https://github.com/yourusername/bookmark-extension-backup.git
   ```

2. **Load the Extension in Your Browser:**

   **For Chrome/Edge:**
   - Go to `chrome://extensions/` or `edge://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the project directory (`bookmark-extension-backup`)

## Usage

- Click the extension icon in your browser toolbar to open the popup.
- Use the interface to:
  - View and search your bookmarks.
  - Export bookmarks and extension data via the backup feature.
  - Switch between open tabs.
  - Manage your installed extensions.

## File Structure

- `manifest.json` - Extension manifest file.
- `popup.html` - Main popup UI.
- `popup-ui.js` - Popup logic and event handling.
- `style.css` - Styles for the popup.
- `components/` - Modular JavaScript components:
  - `backup-feature.js` - Handles backup/export functionality.
  - `bookmark-display.js` - Renders bookmarks in the popup.
  - `backup-handler.js`, `extension-display.js`, `tab-switcher.js`, etc.
  - `core/` - Core utilities for bookmarks, storage, schema, etc.
- `icons/` - Browser and extension icons.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## License

[MIT](LICENSE)

## Credits

Icons from [Simple Icons](https://simpleicons.org/) and browser vendors.

---

**Developed by TheGuy**