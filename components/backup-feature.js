// backup-feature.js
// Handles backup and restore operations for browser extensions and bookmarks using the Pantry cloud service.
// Manages user input for Pantry ID, triggers manual backups, merges live and stored data, and restores data from Pantry.
// Provides UI feedback for backup/restore status and updates local storage to keep extension and bookmark data synchronized.
// components/backup-feature.js
import { SCHEMA_VERSION, getStoredData, mergeExtensionLists, mergeBookmarkTrees } from './data-handler.js'; // Import getStoredData, mergeExtensionLists, mergeBookmarkTrees

/**
 * Saves the Pantry ID to local storage.
 * @param {HTMLInputElement} pantryIdInput - The input element for the Pantry ID.
 * @param {HTMLButtonElement} savePantryIdButton - The button to trigger saving.
 */
function savePantryId(pantryIdInput, savePantryIdButton) {
  const pantryId = pantryIdInput.value.trim();
  if (pantryId) {
    chrome.storage.local.set({ pantryId: pantryId }, () => {
      console.log('Pantry ID saved:', pantryId);
      const originalText = savePantryIdButton.textContent;
      savePantryIdButton.textContent = 'Saved!';
      savePantryIdButton.disabled = true;
      setTimeout(() => {
        savePantryIdButton.textContent = originalText;
        savePantryIdButton.disabled = false;
      }, 1500);
    });
  } else {
    alert('Please enter a Pantry ID.');
  }
}

/**
 * Performs the manual backup process to Pantry.
 * @param {HTMLButtonElement} manualBackupButton - The button to trigger the backup.
 * @param {string} currentBrowserName - The name of the current browser.
 */
async function performManualBackup(manualBackupButton, currentBrowserName) {
  const buttonOriginalText = manualBackupButton.textContent;
  manualBackupButton.disabled = true;
  manualBackupButton.textContent = 'Backing up...';

  // Helper to flatten bookmark tree to flat array of bookmarks (by id)
  function flattenBookmarks(nodes, arr = []) {
    for (const node of nodes) {
      if (node.url) {
        arr.push({ id: node.id, title: node.title, url: node.url });
      }
      if (node.children && Array.isArray(node.children)) {
        flattenBookmarks(node.children, arr);
      }
    }
    return arr;
  }

  // Helper to compare two arrays of objects by id, returns {added, removed}
  function diffById(currentArr, prevArr) {
    const currentIds = new Set(currentArr.map(item => item.id));
    const prevIds = new Set(prevArr.map(item => item.id));
    const added = [...currentIds].filter(id => !prevIds.has(id));
    const removed = [...prevIds].filter(id => !currentIds.has(id));
    return { addedCount: added.length, removedCount: removed.length };
  }

  try {
    // 1. Get Pantry ID
    const { pantryId } = await new Promise((resolve) => chrome.storage.local.get(['pantryId'], resolve));

    if (!pantryId) {
      throw new Error("Pantry ID not set. Please save your Pantry ID first in the Backup tab.");
    }

    // 2. Get Data to Backup (Using Stored Stored Data and Live Install)
    const storedData = await getStoredData();

    // Fetch live installed extensions to ensure backup includes any extensions
    // that may have been installed or uninstalled since the last backup.
    let installedRaw = [];
    if (chrome.management && chrome.management.getAll) {
        try {
            installedRaw = await new Promise((resolve, reject) => {
                chrome.management.getAll(items =>
                    chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(items)
                );
            });
        } catch (err) {
            console.warn("Could not fetch installed extensions:", err);
        }
    }
    // Normalize extension data for backup (only relevant fields).
    const installedExtensions = Array.isArray(installedRaw)
        ? installedRaw.map(item => ({
            id: item.id,
            name: item.name,
            homepageUrl: item.homepageUrl,
            updateUrl: item.updateUrl
        }))
        : [];

    // Merge stored extensions with live installed list to ensure backup
    // contains both previously stored and currently installed extensions.
    // This helps preserve uninstalled extensions in the backup history.
    const extensionsToBackup = mergeExtensionLists(storedData?.extensions || [], installedExtensions);

    // Get live bookmark tree from the browser.
    const bookmarkTree = await new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.bookmarks.getTree) {
            console.warn("Bookmark API not available, backing up empty bookmark list.");
            return resolve([]);
        }
        chrome.bookmarks.getTree(items => {
            if (chrome.runtime.lastError) {
                console.error("Error getting bookmark tree for backup:", chrome.runtime.lastError);
                return resolve([]); // Backup empty list on error
            }
            resolve(items);
        });
    });

    // Merge stored bookmarks with live list to ensure backup includes
    // all bookmarks, even those that may have been deleted or added since last backup.
    const mergedBookmarks = mergeBookmarkTrees(storedData?.bookmarks || [], bookmarkTree);

    const backupData = {
      schemaVersion: storedData?.schemaVersion || SCHEMA_VERSION, // Use stored version or default
      exportedTimestamp: new Date().toISOString(), // Fresh timestamp
      exportedFromBrowser: currentBrowserName,
      extensions: extensionsToBackup, // Use the consolidated list from storage
      bookmarks: mergedBookmarks // Use merged bookmarks list
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
      throw new Error(`Pantry API Error (${response.status}): ${errorText || response.statusText}`);
    }

    const responseText = await response.text();
    console.log('Pantry Backup Response:', responseText);

    // 5. Compare with previous backup and show summary.
    // This provides the user with feedback on what changed since the last backup.
    chrome.storage.local.get(['importedDataList'], (result) => {
        const prevData = result.importedDataList || {};
        // Extensions diff
        const prevExtensions = Array.isArray(prevData.extensions) ? prevData.extensions : [];
        const extDiff = diffById(extensionsToBackup, prevExtensions);

        // Bookmarks diff (flatten both trees for accurate comparison)
        const prevBookmarksTree = Array.isArray(prevData.bookmarks) ? prevData.bookmarks : [];
        const prevBookmarksFlat = flattenBookmarks(prevBookmarksTree);
        const currentBookmarksFlat = flattenBookmarks(mergedBookmarks);
        const bmDiff = diffById(currentBookmarksFlat, prevBookmarksFlat);

        // Compose summary for UI feedback
        const summary =
            `${extDiff.addedCount} extension${extDiff.addedCount !== 1 ? 's' : ''} added, ` +
            `${extDiff.removedCount} removed. ` +
            `${bmDiff.addedCount} bookmark${bmDiff.addedCount !== 1 ? 's' : ''} added, ` +
            `${bmDiff.removedCount} removed.`;

        // Show summary in UI
        const statusElem = document.getElementById('backup-status');
        if (statusElem) {
            statusElem.textContent = summary;
            statusElem.style.color = '#1a7f37';
            statusElem.style.fontWeight = 'bold';
            statusElem.style.marginTop = '10px';
        }

        manualBackupButton.textContent = 'Backup Successful!';
        setTimeout(() => {
            manualBackupButton.textContent = buttonOriginalText;
            manualBackupButton.disabled = false;
        }, 2000);
        // After showing the summary, update importedDataList in storage to reflect the latest backup.
        // This ensures that future diffs and restores use the most recent backup data.
        chrome.storage.local.set({ importedDataList: backupData }, () => {
            if (chrome.runtime.lastError) {
                console.error("Failed to update importedDataList after backup:", chrome.runtime.lastError);
            }
        });
    });

  } catch (error) {
      // Handle any errors during the backup process, including user feedback and UI updates.
      console.error("Backup failed:", error);
      alert(`Backup failed: ${error.message}. Check the extension console (right-click popup -> Inspect) for more details.`);
      manualBackupButton.textContent = 'Backup Failed!';
      setTimeout(() => {
          manualBackupButton.textContent = buttonOriginalText;
          manualBackupButton.disabled = false;
      }, 3000);
      // Also show error in backup-status
      const statusElem = document.getElementById('backup-status');
      if (statusElem) {
          statusElem.textContent = `Backup failed: ${error.message}`;
          statusElem.style.color = '#b91c1c';
          statusElem.style.fontWeight = 'bold';
          statusElem.style.marginTop = '10px';
      }
  }
}

/**
 * Initializes the backup feature elements and event listeners.
 * @param {HTMLInputElement} pantryIdInput - The input element for the Pantry ID.
 * @param {HTMLButtonElement} savePantryIdButton - The button to trigger saving the ID.
 * @param {HTMLButtonElement} manualBackupButton - The button to trigger the manual backup.
 * @param {string} currentBrowserName - The name of the current browser.
 */
export function initializeBackupFeature(pantryIdInput, savePantryIdButton, manualBackupButton, currentBrowserName) {
  // Load Pantry ID on startup
  chrome.storage.local.get(['pantryId'], function(result) {
    if (result.pantryId) {
      pantryIdInput.value = result.pantryId;
    }
  });

  // Event Listeners
  savePantryIdButton.addEventListener('click', () => {
    savePantryId(pantryIdInput, savePantryIdButton);
  });

  manualBackupButton.addEventListener('click', () => {
    performManualBackup(manualBackupButton, currentBrowserName);
  });
}
/**
 * Fetches data from Pantry, saves it to local storage, and triggers UI update.
 * @param {HTMLButtonElement} restoreButton - The button that triggered the restore.
 * @param {Function} successCallback - Function to call after data is successfully saved to storage.
 */
export async function performPantryRestore(restoreButton, successCallback) {
  const buttonOriginalText = restoreButton.textContent;
  restoreButton.disabled = true;
  restoreButton.textContent = 'Restoring...';

  try {
    // 1. Get Pantry ID
    const { pantryId } = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['pantryId'], result => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve(result);
        });
    });

    if (!pantryId) {
      throw new Error("Pantry ID not set. Please save your Pantry ID first in the Backup tab.");
    }

    // 2. Pantry API Call (GET)
    const pantryUrl = `https://getpantry.cloud/apiv1/pantry/${pantryId}/basket/extensionBackup`;
    const response = await fetch(pantryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json' // Important for Pantry GET
      }
    });

    // 3. Handle Response
    if (!response.ok) {
      // Handle cases like 404 Not Found (basket doesn't exist) or other errors
      const errorText = await response.text();
      throw new Error(`Pantry API Error (${response.status}): ${errorText || response.statusText}`);
    }

    const restoredData = await response.json();

    // Basic validation
    if (typeof restoredData !== 'object' || restoredData === null) {
        throw new Error("Invalid data received from Pantry: Not an object.");
    }
     // Optional: Check for expected keys like extensions or bookmarks if needed
     // if (!restoredData.extensions &amp;&amp; !restoredData.bookmarks) {
     //   console.warn("Restored data doesn't contain 'extensions' or 'bookmarks' keys.");
     // }

    // 4. Save to Local Storage
    await new Promise((resolve, reject) => {
        chrome.storage.local.set({ importedDataList: restoredData }, () => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            console.log('Restored data saved to chrome.storage.local');
            resolve();
        });
    });

    // 5. Trigger UI Update via Callback
    if (typeof successCallback === 'function') {
      successCallback();
    }

    // 6. Visual Feedback (Success)
    restoreButton.textContent = 'Restored!';
    setTimeout(() => {
       restoreButton.textContent = buttonOriginalText;
       restoreButton.disabled = false;
    }, 2000);

  } catch (error) {
    console.error("Pantry restore failed:", error);
    alert(`Restore failed: ${error.message}. Check the console for details.`);
    // Visual Feedback (Failure)
    restoreButton.textContent = 'Restore Failed!';
     setTimeout(() => {
       restoreButton.textContent = buttonOriginalText;
       restoreButton.disabled = false;
    }, 3000);
  }
}