// backup-handler.js
// Provides the core logic for manually backing up browser extensions and bookmarks to the Pantry cloud service.
// Collects extension and bookmark data, formats it, and sends it to Pantry using the API.
// Returns status objects for UI feedback and handles errors for robust backup operations.

import { getStoreUrl } from './extension-display.js';
import { SCHEMA_VERSION } from './data-handler.js';

/**
 * Performs a manual backup to the configured Pantry ID.
 * @param {string} currentBrowserName - The name of the current browser.
 * @returns {Promise<{success: boolean, message: string}>} - Object indicating success status and a message.
 */
export async function performManualBackup(currentBrowserName) {
  try {
    // 1. Get Pantry ID
    const { pantryId } = await new Promise((resolve) => chrome.storage.local.get(['pantryId'], resolve));

    if (!pantryId) {
      // Return an error object instead of throwing, so popup.js can handle UI
      return { success: false, message: "Pantry ID not set. Please save your Pantry ID first in the Backup tab." };
    }

    // 2. Get Data to Backup
    // Fetch extensions and bookmarks in parallel for efficiency.
    const [extensions, bookmarkTree] = await Promise.all([
      new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.management || !chrome.management.getAll) return resolve([]);
        chrome.management.getAll(items => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(items));
      }),
      new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.bookmarks.getTree) return resolve([]);
        chrome.bookmarks.getTree(items => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(items));
      })
    ]);

    // Only include actual extensions (not themes/apps), and normalize fields for backup.
    // The storeUrl is derived to allow users to easily reinstall from the correct store.
    const exportableExtensions = extensions
      .filter(ext => ext.type === 'extension')
      .map(ext => ({
        id: ext.id,
        name: ext.name,
        homepageUrl: ext.homepageUrl || null,
        updateUrl: ext.updateUrl || null,
        storeUrl: getStoreUrl(ext, currentBrowserName)
      }));

    const backupData = {
      schemaVersion: SCHEMA_VERSION,
      exportedTimestamp: new Date().toISOString(),
      exportedFromBrowser: currentBrowserName,
      extensions: exportableExtensions,
      bookmarks: bookmarkTree
    };

    // 3. Pantry API Call
    const pantryUrl = `https://getpantry.cloud/apiv1/pantry/${pantryId}/basket/extensionBackup`;
    const response = await fetch(pantryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(backupData)
    });

    // 4. Handle Response
    if (!response.ok) {
      const errorText = await response.text();
      // Throw here because it's an unexpected API/network error during fetch
      throw new Error(`Pantry API Error (${response.status}): ${errorText || response.statusText}`);
    }

    const responseText = await response.text(); // Pantry returns a confirmation message
    console.log('Pantry Backup Response:', responseText);
    return { success: true, message: 'Backup Successful!' };

  } catch (error) {
    console.error("Backup failed:", error); // Log the detailed error
    // Return an error object for popup.js to handle UI feedback gracefully,
    // instead of throwing and breaking the user flow.
    return { success: false, message: `Backup failed: ${error.message}. Check the extension console (right-click popup -> Inspect) for more details.` };
  }
}