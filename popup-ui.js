// popup-ui.js
// Handles UI initialization, DOMContentLoaded, and event listeners for the popup

import {
  loadAndDisplayImportedData,
  getBrowserInfo,
  filterExtensions,
  filterBookmarks,
  handlePantryRestore
} from './components/popup-data.js';

import { exportAllData, importAllData, exportBookmarksAsHtml } from './components/data-handler.js';
import { initializeBackupFeature } from './components/backup-feature.js';
import { switchTab, setupTabButtons } from './components/tab-switcher.js';

document.addEventListener('DOMContentLoaded', function() {
  // --- DOM Elements ---
  const extensionList = document.getElementById('extension-list');
  const bookmarksTreeContainer = document.getElementById('bookmarks-tree-container');
  const exportButton = document.getElementById('export-button');
  const importButton = document.getElementById('import-button');
  const importFileInput = document.getElementById('import-file');
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  const browserInfoElement = document.getElementById('browser-info');
  const restorePantryButton = document.getElementById('restore-from-pantry-btn');

  // Search elements
  const extensionSearchInput = document.getElementById('extension-search-input');
  const extensionSearchButton = document.getElementById('extension-search-button');
  const bookmarkSearchInput = document.getElementById('bookmark-search-input');
  const bookmarkSearchButton = document.getElementById('bookmark-search-button');

  // --- State ---
  let currentBrowserName = 'Unknown';

  // --- Browser Detection ---
  const browserDetails = getBrowserInfo();
  currentBrowserName = browserDetails.name;

  // Update UI with browser info
  let browserDisplayText = `Browser: ${browserDetails.name}`;
  if (browserDetails.version !== "N/A") {
    browserDisplayText += ` v${browserDetails.version}`;
  }
  if (browserDetails.source && browserDetails.source !== "undefined" && browserDetails.source !== "unknown") {
    browserDisplayText += ` (Source: ${browserDetails.source})`;
  }
  if (browserDetails.name === "Unknown" && browserDetails.userAgent) {
    const uaSubstring = browserDetails.userAgent.length > 70 ? browserDetails.userAgent.substring(0, 67) + "..." : browserDetails.userAgent;
    browserDisplayText += ` - UA: ${uaSubstring}`;
  }
  browserInfoElement.textContent = browserDisplayText;

  // Log browser info
  console.log("Detected Browser Details:", browserDetails);

  if (browserDetails.name === "Brave") {
    console.log("This is Brave Browser.");
    if (window.brave && typeof window.brave.isBrave === 'function') {
      window.brave.isBrave().then(isIndeedBrave => {
        if (isIndeedBrave) {
          console.log("Confirmation: window.brave.isBrave() returned true.");
        } else {
          console.warn("Alert: window.brave object exists, but isBrave() returned false.");
        }
      }).catch(err => {
        console.warn("Error calling window.brave.isBrave():", err);
      });
    }
  } else if (browserDetails.name !== "Unknown") {
    console.log(`This is ${browserDetails.name} version ${browserDetails.version}. Detected via: ${browserDetails.source}`);
  } else {
    console.warn("Could not reliably detect the browser. Full User Agent:", browserDetails.userAgent);
  }

  const commonBrowsers = [
    "Chrome", "Safari", "Firefox", "Edge", "Opera",
    "Samsung Browser", "Brave", "UC Browser", "Vivaldi", "QQ Browser"
  ];
  if (commonBrowsers.includes(browserDetails.name)) {
    console.log(`The detected browser (${browserDetails.name}) is one of the commonly tracked browsers.`);
  }

  // --- Tab Setup ---
  function switchTabWrapper(tabId) {
    switchTab(tabId, tabButtons, tabContents);
  }
  setupTabButtons(tabButtons, tabContents, switchTabWrapper);

  // --- Initial Load ---
  loadAndDisplayImportedData(extensionList, bookmarksTreeContainer, switchTabWrapper, currentBrowserName)
    .catch(error => {
      console.error("Error loading initial data:", error);
      extensionList.innerHTML = `<li class="error-text">Error loading extension data: ${error.message}</li>`;
      bookmarksTreeContainer.innerHTML = `<p class="error-text">Error loading bookmark data: ${error.message}</p>`;
    });

  // --- Backup Feature ---
  const pantryIdInput = document.getElementById('pantry-id-input');
  const savePantryIdButton = document.getElementById('save-pantry-id-button');
  const manualBackupButton = document.getElementById('manual-backup-button');
  if (pantryIdInput && savePantryIdButton && manualBackupButton) {
    initializeBackupFeature(pantryIdInput, savePantryIdButton, manualBackupButton, currentBrowserName);
  }

  // --- Export/Import Buttons ---
  exportButton.addEventListener('click', () => {
    exportAllData(currentBrowserName);
  });
  importButton.addEventListener('click', () => {
    importFileInput.click();
  });

  // Export bookmarks as HTML
  const exportBookmarksBtn = document.getElementById('export-extensions-as-bookmarks-button');
  if (exportBookmarksBtn) {
    exportBookmarksBtn.addEventListener('click', () => {
      exportBookmarksAsHtml();
    });
  }

  // --- Search Listeners ---
  if (extensionSearchInput) {
    extensionSearchInput.addEventListener('input', (e) =>
      filterExtensions(e.target.value, extensionList, currentBrowserName)
    );
    extensionSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        filterExtensions(e.target.value, extensionList, currentBrowserName);
      }
    });
  }
  if (extensionSearchButton) {
    extensionSearchButton.addEventListener('click', () =>
      filterExtensions(extensionSearchInput.value, extensionList, currentBrowserName)
    );
  }
  if (bookmarkSearchInput) {
    bookmarkSearchInput.addEventListener('input', (e) =>
      filterBookmarks(e.target.value, bookmarksTreeContainer)
    );
    bookmarkSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        filterBookmarks(e.target.value, bookmarksTreeContainer);
      }
    });
  }
  if (bookmarkSearchButton) {
    bookmarkSearchButton.addEventListener('click', () =>
      filterBookmarks(bookmarkSearchInput.value, bookmarksTreeContainer)
    );
  }

  // --- Import File Input ---
  importFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      importAllData({
        file,
        extensionList,
        bookmarksTreeContainer,
        switchTab: switchTabWrapper,
        currentContextBrowserName: currentBrowserName
      });
    }
    event.target.value = null;
  });

  // --- Pantry Restore Button ---
  if (restorePantryButton) {
    restorePantryButton.addEventListener('click', () =>
      handlePantryRestore(restorePantryButton, extensionList, bookmarksTreeContainer, switchTabWrapper, currentBrowserName)
    );
  }
});