// extension-display.js
// Manages the UI for displaying, sorting, and interacting with browser extensions, including install, uninstall, enable/disable, and removal actions.
// Handles favicon and store URL logic, provides real-time updates to the extension list, and supports user-driven extension management.
// Integrates with data handlers to keep the UI and stored data synchronized for a seamless extension management experience.
// Extension Display Component

import { removeExtensionFromList } from './data-handler.js';

let currentSortMode = 'name';
let lastDisplayParams = null;
// SVG constants and helper for favicon/store URL
export const FOLDER_ICON_SVG = 'data:image/svg+xml;utf8,<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="2" fill="%23f4d06f"/><path d="M2 5.5A1.5 1.5 0 013.5 4h2.379a1.5 1.5 0 011.06.44l.621.62A1.5 1.5 0 008.621 6H12.5A1.5 1.5 0 0114 7.5v4A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-6z" fill="%23e2b93b"/></svg>';
export const DEFAULT_FAVICON_SVG = 'data:image/svg+xml;utf8,<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="2" fill="%23e0e0e0"/><path d="M4 4h8v8H4z" fill="%23bdbdbd"/></svg>';

/**
 * Returns the appropriate store URL for an extension, based on its updateUrl and the current browser context.
 * - If the extension was installed from a different store than the current browser, returns a search URL for the current store.
 * - Otherwise, links directly to the extension's detail page in its original store.
 * - Falls back to a store search if the source cannot be determined.
 */
export function getStoreUrl(extension, currentContextBrowserName) {
  const id = extension.id;
  const name = extension.name; // Need the name for search queries
  const updateUrl = extension.updateUrl;

  let sourceStore = null; // 'chrome' or 'edge'
  if (updateUrl) {
    if (updateUrl.includes('edge.microsoft.com')) {
      sourceStore = 'edge';
    } else if (updateUrl.includes('google.com')) { // Assume google.com means Chrome store
      sourceStore = 'chrome';
    }
  }

  // Cross-browser search redirection logic
  if (sourceStore === 'chrome' && currentContextBrowserName === 'Edge') {
    // Source is Chrome Store, but current browser is Edge -> Search Edge Store
    return `https://microsoftedge.microsoft.com/addons/search/${encodeURIComponent(name)}`;
  } else if (sourceStore === 'edge' && currentContextBrowserName === 'Chrome') {
    // Source is Edge Store, but current browser is Chrome -> Search Chrome Store
    return `https://chromewebstore.google.com/search/${encodeURIComponent(name)}`;
  }

  // Default: Link to the original store's detail page
  if (sourceStore === 'edge') {
    return `https://microsoftedge.microsoft.com/addons/detail/${id}`;
  } else if (sourceStore === 'chrome') {
    return `https://chrome.google.com/webstore/detail/${id}`;
  }

  // Fallback if updateUrl didn't identify the store
  if (currentContextBrowserName === 'Edge') {
    // If context is Edge and we couldn't determine source, search Edge store as a best guess
    return `https://microsoftedge.microsoft.com/addons/search/${encodeURIComponent(name)}`;
  } else { // Default to Chrome store as the ultimate fallback
    // If context is Chrome (or unknown) and we couldn't determine source, search Chrome store
     return `https://chromewebstore.google.com/search/${encodeURIComponent(name)}`;
  }
}

/**
 * Returns a favicon URL for a given site, or a default icon for folders/invalid URLs.
 * Uses Google's favicon service for consistency.
 */
export function getFaviconUrl(url) {
  if (!url) return FOLDER_ICON_SVG;
  try {
    const domainMatch = url.match(/^https?:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
    const domain = domainMatch ? domainMatch[1] : null;
    if (domain) {
      return `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
    } else {
      return DEFAULT_FAVICON_SVG;
    }
  } catch (e) {
    return DEFAULT_FAVICON_SVG;
  }
}

// Helper function to get extension info (including enabled status)
async function getExtensionInfo(extensionId) {
  return new Promise((resolve) => {
    if (!chrome.management || !chrome.management.get) {
      console.warn("chrome.management API not available.");
      return resolve(null); // Return null if API is missing
    }
    chrome.management.get(extensionId, (info) => {
      if (chrome.runtime.lastError) {
        // lastError indicates the extension is not installed
        resolve(null); // Return null if not found or other error
      } else {
        resolve(info); // Return the full info object
      }
    });
  });
}


export async function displayExtensions({
  extensionList,
  extensionsToDisplay,
  installedExtensionsMap = new Map(),
  currentContextBrowserName = 'Unknown'
}) {
  lastDisplayParams = { extensionList, extensionsToDisplay, installedExtensionsMap, currentContextBrowserName };
  let sortedExtensions = [...extensionsToDisplay];
  if (currentSortMode === 'name') {
    sortedExtensions.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSortMode === 'installed') {
    const extInstallPairs = await Promise.all(sortedExtensions.map(async ext => {
      const info = await getExtensionInfo(ext.id);
      const installed = !!info;
      return { ext, installed };
    }));
    extInstallPairs.sort((a, b) => (b.installed === a.installed ? 0 : b.installed ? 1 : -1));
    sortedExtensions = extInstallPairs.map(pair => pair.ext);
  }
  extensionList.innerHTML = ''; // Clear previous list

  if (!extensionsToDisplay || extensionsToDisplay.length === 0) {
    extensionList.innerHTML = '<li class="empty-text">No extensions to display.</li>';
    return;
  }

  // Remove and re-add event listeners to prevent duplicate handlers
  // when the extension list is re-rendered. This avoids memory leaks and
  // ensures only one handler is active for each event type.
  extensionList.removeEventListener('click', handleExtensionActionClick); // Remove previous if any
  extensionList.removeEventListener('change', handleExtensionActionClick); // Remove previous if any
  extensionList.addEventListener('click', handleExtensionActionClick);
  extensionList.addEventListener('change', handleExtensionActionClick); // Listen for toggle changes

  // Process each extension asynchronously
  for (const ext of sortedExtensions) {
    if (!ext || !ext.id || !ext.name) continue;

    const extensionInfo = await getExtensionInfo(ext.id); // Get full info or null
    const isInstalled = !!extensionInfo; // True if info object exists
    const isEnabled = isInstalled ? extensionInfo.enabled : false; // Get enabled status if installed

    const listItem = createExtensionListItem(ext, isInstalled, isEnabled, currentContextBrowserName);
    extensionList.appendChild(listItem);
  }
}

// Function to create the HTML structure for a single extension item
function createExtensionListItem(ext, isInstalled, isEnabled, currentContextBrowserName) {
  const listItem = document.createElement('li');
  listItem.classList.add('extension-item');
  listItem.dataset.extensionId = ext.id; // Store ID for event listeners
  if (!isInstalled) {
    listItem.classList.add('not-installed');
  }

  let storeUrl = getStoreUrl(ext, currentContextBrowserName);

  let detailsHtml = '';
  if (ext.homepageUrl) {
    detailsHtml += `<div class="extension-detail homepage-url">Homepage: <a href="${ext.homepageUrl}" target="_blank" title="${ext.homepageUrl}">${ext.homepageUrl}</a></div>`;
  }

  // Determine initial state for toggle
  const isChecked = isInstalled && isEnabled;
  const isDisabled = !isInstalled; // Disable toggle if not installed

  // Generate Toggle Switch HTML
  const toggleHtml = `
    <label class="switch" title="${isInstalled ? (isEnabled ? 'Deactivate Extension' : 'Activate Extension') : 'Extension not installed'}">
      <input class="switch__input" type="checkbox" role="switch" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
      <svg class="switch__letters" viewBox="0 0 24 24" width="24px" height="24px" aria-hidden="true">
        <g stroke="currentcolor" stroke-linecap="round" stroke-width="4" transform="translate(0,4)">
          <g class="switch__letter">
            <polyline class="switch__letter-stroke" points="2 2,2 14" />
            <polyline class="switch__letter-stroke" points="2 2,16 2" stroke-dasharray="14 16" stroke-dashoffset="8" transform="rotate(0,2,2)" />
            <polyline class="switch__letter-stroke" points="2 8,6 8" stroke-dasharray="4 6" />
          </g>
          <g class="switch__letter" transform="translate(14,0)">
            <polyline class="switch__letter-stroke" points="2 2,2 14" />
            <polyline class="switch__letter-stroke" points="2 2,8 2" stroke-dasharray="6 8" />
            <polyline class="switch__letter-stroke" points="2 8,6 8" stroke-dasharray="4 6" />
          </g>
        </g>
      </svg>
      <span class="switch__text"></span>
    </label>
  `;

  // Determine which icon to show based on updateUrl
  let sourceIconHtml = '';
  if (ext.updateUrl) {
    if (ext.updateUrl.startsWith('https://clients2.google.com/service/update2/crx')) {
      sourceIconHtml = '<img src="icons/chrome.svg" class="extension-source-icon" alt="Chrome Store">';
    } else if (ext.updateUrl.startsWith('https://edge.microsoft.com/extensionwebstorebase/v1/crx')) {
      sourceIconHtml = '<img src="icons/edge.svg" class="extension-source-icon" alt="Edge Store">';
    }
  }

  listItem.innerHTML = `
    <div class="extension-info">
      <strong>${ext.name}</strong>${sourceIconHtml} ${!isInstalled ? '<span class="status-badge not-installed-badge">(Not Installed)</span>' : (isEnabled ? '' : '<span class="status-badge disabled-badge">(Disabled)</span>')}
      ${detailsHtml}
    </div>
    <div class="extension-actions">
      ${toggleHtml} <!-- Add the toggle switch here -->
      <a href="${storeUrl}" target="_blank" class="button install-button ${isInstalled ? 'disabled' : ''}" title="${isInstalled ? 'Extension is already installed' : `Visit Store Page for ${ext.name}`}" ${isInstalled ? 'aria-disabled="true"' : ''}>Install</a>
      <button class="button uninstall-button" title="Uninstall Extension" ${!isInstalled ? 'disabled' : ''}>Uninstall</button>
      <button class="button remove-button" title="Remove from this list"><img src="icons/trash.svg" alt="Remove" class="icon"></button>
    </div>
  `;

  return listItem;
}

// Event handler for clicks and changes within the extension list
async function handleExtensionActionClick(event) {
  const target = event.target;
  const listItem = target.closest('.extension-item');
  if (!listItem) return; // Clicked outside an item or relevant element

  const extensionId = listItem.dataset.extensionId;
  if (!extensionId) return; // Should not happen

  // Handle Toggle Switch Change
  if (target.matches('.switch__input') && event.type === 'change') {
    const isEnabled = target.checked;
    console.log(`Setting extension ${extensionId} enabled status to: ${isEnabled}`);

    if (!chrome.management || !chrome.management.setEnabled) {
      alert("Enable/Disable feature is not available in this browser.");
      // Revert visual state if API is not available
      target.checked = !isEnabled;
      return;
    }

    chrome.management.setEnabled(extensionId, isEnabled, () => {
      if (chrome.runtime.lastError) {
        console.error(`Error setting enabled state for ${extensionId}:`, chrome.runtime.lastError);
        alert(`Could not ${isEnabled ? 'enable' : 'disable'} extension: ${chrome.runtime.lastError.message}`);
        // Revert visual state on error
        target.checked = !isEnabled;
      } else {
        console.log(`Extension ${extensionId} ${isEnabled ? 'enabled' : 'disabled'} successfully.`);
        // Update UI elements (like badge and title) after successful state change
        const toggleLabel = target.closest('.switch');
        if (toggleLabel) {
            toggleLabel.title = isEnabled ? 'Deactivate Extension' : 'Activate Extension';
        }
        const infoDiv = listItem.querySelector('.extension-info');
        let statusBadge = infoDiv.querySelector('.status-badge.disabled-badge');
        if (isEnabled) {
            if (statusBadge) statusBadge.remove(); // Remove disabled badge if enabling
        } else {
            if (!statusBadge) { // Add disabled badge if disabling and it doesn't exist
                statusBadge = document.createElement('span');
                statusBadge.classList.add('status-badge', 'disabled-badge');
                statusBadge.textContent = '(Disabled)';
                // Find the name and icon elements
                const nameElement = infoDiv.querySelector('strong');
                const iconElement = infoDiv.querySelector('.extension-source-icon');
                // Insert after icon if it exists, otherwise after name
                const insertAfterElement = iconElement || nameElement;
                insertAfterElement.insertAdjacentElement('afterend', statusBadge);
            }
        }
      }
    });
  }
  // Handle Uninstall Button Click
  else if (target.matches('.uninstall-button') && event.type === 'click') {
    if (!chrome.management || !chrome.management.uninstall) {
      alert("Uninstall feature is not available in this browser.");
      return;
    }
    // Confirm before uninstalling (optional, but good practice)

    console.log(`Attempting to uninstall ${extensionId}`);
    chrome.management.uninstall(extensionId, { showConfirmDialog: true }, () => {
      if (chrome.runtime.lastError) {
        console.error(`Error uninstalling ${extensionId}:`, chrome.runtime.lastError);
        alert(`Could not uninstall extension: ${chrome.runtime.lastError.message}`);
      } else {
        console.log(`Extension ${extensionId} uninstalled successfully.`);
        // Visually update the item - mark as not installed, disable uninstall/toggle buttons
        listItem.classList.add('not-installed');
        const uninstallButton = listItem.querySelector('.uninstall-button');
        if (uninstallButton) uninstallButton.disabled = true;
        const installButton = listItem.querySelector('.install-button');
        if (installButton) {
            installButton.classList.remove('disabled');
            installButton.removeAttribute('aria-disabled');
            installButton.title = `Visit Store Page for ${listItem.querySelector('strong').textContent}`;
        }
        const toggleInput = listItem.querySelector('.switch__input');
        if (toggleInput) {
            toggleInput.disabled = true;
            toggleInput.checked = false; // Ensure toggle is off visually
            const toggleLabel = toggleInput.closest('.switch');
            if (toggleLabel) toggleLabel.title = 'Extension not installed';
        }

        // Update or add the "Not Installed" badge
        const infoDiv = listItem.querySelector('.extension-info');
        let statusBadge = infoDiv.querySelector('.status-badge.not-installed-badge');
        const disabledBadge = infoDiv.querySelector('.status-badge.disabled-badge');
        if(disabledBadge) disabledBadge.remove(); // Remove disabled badge if present

        if (!statusBadge) { // Add "Not Installed" badge if it doesn't exist
            statusBadge = document.createElement('span');
            statusBadge.classList.add('status-badge', 'not-installed-badge');
            statusBadge.textContent = '(Not Installed)';
            infoDiv.querySelector('strong').insertAdjacentElement('afterend', statusBadge);
        } else {
            statusBadge.textContent = '(Not Installed)'; // Ensure text is correct
        }
      }
    });
  }

  // Handle Remove Button Click
  else if (target.matches('.remove-button') && event.type === 'click') {
    console.log(`Attempting to remove ${extensionId} from the list.`);
    try {
      const removed = await removeExtensionFromList(extensionId);
      if (removed) {
        listItem.remove(); // Remove the item from the UI
        console.log(`Extension ${extensionId} removed from UI.`);
        // Check if the list is now empty
        const extensionList = listItem.parentElement;
        if (extensionList && !extensionList.querySelector('.extension-item')) {
            extensionList.innerHTML = '<li class="empty-text">No extensions to display.</li>';
        }
      } else {
        console.warn(`Extension ${extensionId} was not found in the stored list or removal failed.`);
        // Optionally alert the user, though console warning might suffice
      }
    } catch (error) {
      console.error(`Error removing extension ${extensionId} from list:`, error);
      alert(`Could not remove extension from the list. See console for details.`);
    }
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const sortNameBtn = document.getElementById('sort-name-button');
  const sortInstallBtn = document.getElementById('sort-install-button');

  if (sortNameBtn) {
    sortNameBtn.addEventListener('click', async () => {
      currentSortMode = 'name';
      if (lastDisplayParams) {
        await displayExtensions(lastDisplayParams);
      }
    });
  }

  if (sortInstallBtn) {
    sortInstallBtn.addEventListener('click', async () => {
      currentSortMode = 'installed';
      if (lastDisplayParams) {
        await displayExtensions(lastDisplayParams);
      }
    });
  }
});