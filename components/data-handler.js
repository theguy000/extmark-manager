// data-handler.js
// Core utility module for managing browser extension and bookmark data, including export, import, merge, and sync operations.
// Handles browser detection, schema versioning, and data storage/retrieval from local storage and browser APIs.
// Provides functions for removing, merging, and exporting bookmarks/extensions, supporting UI modules with robust data management.
// Data Handler Component
import { displayExtensions } from './extension-display.js';
import { displayBookmarks } from './bookmark-display.js';

// Detect current browser environment
/**
 * Detects the current browser environment.
 * The order of checks is important due to overlapping user agent strings (e.g., Chrome includes "Safari").
 * This logic ensures the most specific browser is detected first.
 */
const DETECTED_BROWSER = (() => {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return 'unknown';
  }

  const userAgent = navigator.userAgent;

  // Check for Brave (Brave shields adds "Brave" to the user agent)
  if (userAgent.includes("Brave")) {
    return 'brave';
  }

  // Check for Opera
  if (userAgent.includes("Opera") || userAgent.includes("OPR/")) {
    return 'opera';
  }

  // Check for Edge (Chromium-based) - Must be checked before Chrome due to userAgent similarities
  if (userAgent.includes("Edg/")) {
    return 'edge';
  }

  // Check for Chrome
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && userAgent.includes("Chrome/")) {
    return 'chrome';
  }

  // Check for Safari (must be after Chrome check because Chrome also includes "Safari" in userAgent)
  if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
    return 'safari';
  }

  // Check for Firefox (browser.runtime is the standard WebExtensions API)
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) {
    return 'firefox';
  }

  return 'unknown';
})();

/**
 * Recursively adds the browser name to each bookmark node in a tree.
 * Creates new node objects to avoid mutating the original tree.
 * @param {Array<object>} nodes - The array of bookmark nodes.
 * @param {string} browserName - The name of the browser.
 * @returns {Array<object>} A new array of nodes with browser information.
 */
function addBrowserToBookmarkNodes(nodes, browserName) {
  if (!nodes || !Array.isArray(nodes)) {
    return nodes; // Return original if not an array (e.g. null or undefined)
  }
  return nodes.map(node => {
    // Create a shallow copy to avoid modifying original objects if they come from other sources.
    const newNode = { ...node };
    if (newNode.url) { // It's a bookmark (has a URL), not a folder
      newNode.browser = browserName;
    }
    // If the node has children, recursively process them.
    if (newNode.children && newNode.children.length > 0) {
      newNode.children = addBrowserToBookmarkNodes(newNode.children, browserName);
    }
    return newNode;
  });
}

export const SCHEMA_VERSION = 1;
/**
 * Removes a bookmark by its ID using the Chrome Bookmarks API.
 * @param {string} bookmarkId - The ID of the bookmark to remove.
 * @returns {Promise<void>}
 */
export async function removeBookmarkById(bookmarkId) {
  // First, get the node to determine if it's a folder or bookmark
  return new Promise((resolve, reject) => {
    chrome.bookmarks.get(bookmarkId, (results) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      const node = results && results[0];
      if (!node) {
        return reject(new Error('This bookmark or folder no longer exists.'));
      }
      if (node.children) {
        // It's a folder, use removeTree
        chrome.bookmarks.removeTree(bookmarkId, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } else {
        // It's a bookmark, use remove
        chrome.bookmarks.remove(bookmarkId, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      }
    });
  });
}

export async function exportAllData(browserName) {
  try {
    // --- EXPORT LOGIC USING STORED DATA ---
    // 1. Get the consolidated data from storage
    const storedData = await getStoredData(); // Uses the helper function

    // Fetch live installed extensions to include uninstalled ones in export
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
    const installedExtensions = Array.isArray(installedRaw)
      ? installedRaw.map(item => ({
          id: item.id,
          name: item.name,
          homepageUrl: item.homepageUrl,
          updateUrl: item.updateUrl
        }))
      : [];

    // Merge stored extensions with live installed list, keeping all extensions
    const extensionsToExport = mergeExtensionLists(storedData?.extensions || [], installedExtensions);

    // 2. Get the current live bookmark tree (bookmarks are dynamic)
    const bookmarkTreeLive = await new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.bookmarks.getTree) {
        console.warn("Bookmark API not available, exporting empty bookmark list.");
        return resolve([]); // Resolve with empty if API unavailable
      }
      chrome.bookmarks.getTree(items => {
        if (chrome.runtime.lastError) {
          console.error("Error getting bookmark tree:", chrome.runtime.lastError);
          return resolve([]); // Resolve empty on error
        }
        resolve(items);
      });
    });

    // Add browser information to live bookmarks before merging
    // The addBrowserToBookmarkNodes function returns a new tree with the 'browser' property added.
    const processedBookmarkTreeLive = addBrowserToBookmarkNodes(bookmarkTreeLive, DETECTED_BROWSER);

    // Merge stored bookmarks with live list, keeping all bookmarks
    const bookmarksToExport = mergeBookmarkTrees(storedData?.bookmarks || [], processedBookmarkTreeLive);

    // 3. Prepare the complete export object
    const exportData = {
      schemaVersion: storedData?.schemaVersion || SCHEMA_VERSION, // Use stored version or default
      exportedTimestamp: new Date().toISOString(), // Fresh timestamp for this export
      exportedFromBrowser: browserName,
      extensions: extensionsToExport, // Use the consolidated list
      bookmarks: bookmarksToExport // Use the merged bookmarks list
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `browser_data_backup_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (error) {
    console.error("Error during export:", error);
    alert("Could not export data. See console for details.");
  }
}

export function importAllData({
  file,
  extensionList,
  bookmarksTreeContainer,
  switchTab,
  currentContextBrowserName
}) {
  const reader = new FileReader();
  reader.onload = async function(event) {
    try {
      const importedFileData = JSON.parse(event.target.result);

      if (typeof importedFileData !== 'object' || importedFileData === null) {
        throw new Error("Invalid JSON file: Not an object.");
      }
      if (!importedFileData.schemaVersion || importedFileData.schemaVersion !== SCHEMA_VERSION) {
        console.warn(`Importing data with schema version ${importedFileData.schemaVersion || 'unknown'}. Expected ${SCHEMA_VERSION}.`);
      }

      // Get currently stored data
      const storedData = await getStoredData();
      const storedExtensions = storedData?.extensions || [];
      const importedExtensions = importedFileData?.extensions || [];

      // Merge the lists (imported list takes priority)
      const mergedExtensions = mergeExtensionLists(storedExtensions, importedExtensions);

      // Prepare data to be saved
      const dataToSave = {
          schemaVersion: importedFileData.schemaVersion || SCHEMA_VERSION,
          exportedTimestamp: importedFileData.exportedTimestamp || new Date().toISOString(),
          exportedFromBrowser: importedFileData.exportedFromBrowser || 'Unknown',
          extensions: mergedExtensions,
          bookmarks: importedFileData.bookmarks || storedData?.bookmarks || []
      };

      // Fetch installed extensions for display comparison
      let installedExtensionsMap = new Map();
      if (chrome.management && chrome.management.getAll) {
        try {
          const installed = await new Promise((resolve, reject) => {
            chrome.management.getAll(items => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(items));
          });
          installedExtensionsMap = new Map(installed.map(ext => [ext.id, ext]));
        } catch (err) {
          console.error("Could not get installed extensions for comparison:", err);
          alert("Warning: Could not verify currently installed extensions.");
        }
      }

      // Display merged extensions
      if (dataToSave.extensions && dataToSave.extensions.length > 0) {
        displayExtensions({
          extensionList,
          extensionsToDisplay: dataToSave.extensions,
          installedExtensionsMap,
          currentContextBrowserName
        });
        switchTab('extensions');
      } else {
        extensionList.innerHTML = '<li class="empty-text">No extension data found after merge.</li>';
      }

      // Display and sync bookmarks
      if (dataToSave.bookmarks && dataToSave.bookmarks.length > 0) {
        displayBookmarks(bookmarksTreeContainer, dataToSave.bookmarks);
        
        // Sync bookmarks with browser UI if API is available
        if (typeof chrome !== 'undefined' && chrome.bookmarks) {
          try {
            // First get current bookmarks bar to preserve its structure
            const currentBookmarks = await new Promise(resolve => {
              chrome.bookmarks.getTree(items => resolve(items));
            });
            
            // Find the bookmarks bar folder
            const bookmarksBar = findBookmarksBar(currentBookmarks);
            
            // Merge imported bookmarks into the bookmarks bar
            if (bookmarksBar) {
              await mergeBookmarksIntoBrowser(dataToSave.bookmarks, bookmarksBar.id);
              console.log("Bookmarks successfully synced with browser UI");
            }
          } catch (err) {
            console.error("Error syncing bookmarks with browser:", err);
          }
        }

        if (!dataToSave.extensions || dataToSave.extensions.length === 0) {
          switchTab('bookmarks');
        }
      } else {
        bookmarksTreeContainer.innerHTML = '<p class="empty-text">No bookmark data found in file or storage.</p>';
      }

      // Save merged data
      await new Promise((resolve, reject) => {
          chrome.storage.local.set({ importedDataList: dataToSave }, () => {
              if (chrome.runtime.lastError) {
                  console.error("Error saving merged data:", chrome.runtime.lastError);
                  return reject(chrome.runtime.lastError);
              }
              console.log("Merged data saved successfully.");
              resolve();
          });
      });


    } catch (e) {
      console.error("Error processing import file:", e);
      alert(`Error reading file: ${e.message}`);
    }
  };
  reader.onerror = function() {
    console.error("File reading error:", reader.error);
    alert("Could not read the selected file.");
  };
  reader.readAsText(file);
}

/**
 * Removes an extension from the stored importedDataList in chrome.storage.local.
 * @param {string} extensionId The ID of the extension to remove.
 * @returns {Promise<boolean>} True if removal was successful, false otherwise.
 */
export async function removeExtensionFromList(extensionId) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('importedDataList', (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting stored data:", chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }

      const importedData = result.importedDataList;
      if (!importedData || !importedData.extensions || !Array.isArray(importedData.extensions)) {
        console.warn("No valid extension list found in storage to remove from.");
        return resolve(false); // Or reject? Resolve false seems safer.
      }

      const initialLength = importedData.extensions.length;
      importedData.extensions = importedData.extensions.filter(ext => ext.id !== extensionId);

      if (importedData.extensions.length === initialLength) {
        console.warn(`Extension with ID ${extensionId} not found in the stored list.`);
        return resolve(false); // Indicate that nothing was removed
      }

      chrome.storage.local.set({ importedDataList: importedData }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving updated data:", chrome.runtime.lastError);
          return reject(chrome.runtime.lastError);
        }
        console.log(`Extension ${extensionId} removed from the list.`);
        resolve(true); // Indicate successful removal
      });
    });
  });
}


/**
 * Retrieves the data (extensions, bookmarks, etc.) stored by the extension.
 * @returns {Promise<object|null>} The stored data object or null if not found/error.
 */
export async function getStoredData() {
    return new Promise((resolve) => { // Changed reject to resolve(null) for easier handling
        chrome.storage.local.get('importedDataList', (result) => {
            if (chrome.runtime.lastError) {
                console.error("Error getting stored data:", chrome.runtime.lastError);
                // Resolve with null in case of error to prevent breaking callers expecting an object/null
                return resolve(null);
            }
            // Ensure we always return an object, even if empty, or null if nothing found
            resolve(result.importedDataList || null);
        });
    });
}
/**
 * Deeply merges two bookmark trees, deduplicating by URL and title.
 * - Folders with the same title are merged recursively, except for 'Bookmarks Bar', which is replaced.
 * - Bookmarks are only added if not already present (by URL and title).
 * This ensures a comprehensive, non-redundant bookmark structure after import/merge.
 */
export function mergeBookmarkTrees(listA = [], listB = []) {
    // Deep clone listA to avoid mutating input
    const merged = JSON.parse(JSON.stringify(listA));

    // Helper to deduplicate bookmarks by URL and title
    const isDuplicateBookmark = (target, node) => {
        return target.some(t =>
            t.url && node.url &&
            t.url === node.url &&
            t.title === node.title
        );
    };

    const isDuplicateFolder = (target, node) => {
        return target.some(t =>
            t.children && node.children && // Both are folders
            t.url && node.url && // Both have URLs
            t.url === node.url // URLs match
        );
    };

    // Recursively merge nodes from source into target, handling folders and bookmarks.
    const mergeNodes = (target, source) => {
        for (const srcNode of source) {
            const srcNodeCopy = JSON.parse(JSON.stringify(srcNode)); // Work with a copy

            if (srcNodeCopy.children) { // srcNodeCopy is a folder
                const existingFolderInTarget = target.find(
                    t => t.children && t.title === srcNodeCopy.title
                );

                if (existingFolderInTarget) { // Folder with same title exists in target
                    if (srcNodeCopy.title === 'Bookmarks Bar') {
                        // For 'Bookmarks Bar', replace its children with srcNodeCopy's children.
                        existingFolderInTarget.children = srcNodeCopy.children; // srcNodeCopy.children is already a deep copy
                    } else {
                        // For other folders, recursively merge their children.
                        // Also, ensure the title of existing folder remains consistent (e.g. casing from srcNodeCopy if preferred)
                        existingFolderInTarget.title = srcNodeCopy.title; // Ensures title (e.g. casing) from srcNode is used
                        mergeNodes(existingFolderInTarget.children, srcNodeCopy.children);
                    }
                } else { // No folder with the same title exists in target
                    target.push(srcNodeCopy); // Add the new folder (already a deep copy)
                }
            } else { // srcNodeCopy is a bookmark (file)
                // Only add if not a duplicate (by URL and title)
                if (!isDuplicateBookmark(target, srcNodeCopy)) {
                    target.push(srcNodeCopy);
                }
            }
        }
    };

    mergeNodes(merged, listB);
    return merged;
}

/**
 * Finds the Bookmarks Bar folder in the bookmark tree
 */
/**
 * Finds the Bookmarks Bar folder in the bookmark tree.
 * This is necessary for syncing imported bookmarks into the correct location in the browser.
 */
function findBookmarksBar(bookmarkTree) {
    if (!bookmarkTree || !bookmarkTree.length) return null;
    
    // First level is usually the root node
    const root = bookmarkTree[0];
    if (!root.children) return null;
    
    // Look for Bookmarks Bar in root's children
    return root.children.find(node =>
        node.title === 'Bookmarks Bar' ||
        (node.id && node.id.startsWith('1')) // Chrome's bookmarks bar usually has ID starting with 1
    );
}

/**
 * Merges bookmarks into the browser's bookmarks bar
 */
/**
 * Merges imported bookmarks into the browser's bookmarks bar.
 * - Clears existing bookmarks (except special folders) before adding new ones.
 * - Recursively creates folders and bookmarks to match the imported structure.
 * This is used during import to sync the UI and browser state.
 */
async function mergeBookmarksIntoBrowser(importedBookmarks, bookmarksBarId) {
    if (!importedBookmarks || !importedBookmarks.length) return;
    
    // First clear existing bookmarks bar (except special folders)
    const existingBookmarks = await new Promise(resolve => {
        chrome.bookmarks.getChildren(bookmarksBarId, children => resolve(children || []));
    });
    
    // Remove non-special bookmarks
    for (const bookmark of existingBookmarks) {
        if (!bookmark.title.startsWith('_')) { // Skip special folders
            await new Promise(resolve => {
                chrome.bookmarks.remove(bookmark.id, () => resolve());
            });
        }
    }
    
    // Add imported bookmarks recursively
    const addBookmarks = async (parentId, bookmarks) => {
        for (const bookmark of bookmarks) {
            if (bookmark.children) {
                // Create folder
                const newFolder = await new Promise(resolve => {
                    chrome.bookmarks.create({
                        parentId,
                        title: bookmark.title
                    }, folder => resolve(folder));
                });
                
                // Add children recursively
                await addBookmarks(newFolder.id, bookmark.children);
            } else {
                // Create bookmark
                await new Promise(resolve => {
                    chrome.bookmarks.create({
                        parentId,
                        title: bookmark.title,
                        url: bookmark.url
                    }, () => resolve());
                });
            }
        }
    };
    
    await addBookmarks(bookmarksBarId, importedBookmarks);
}

/**
 * Merges two lists of extension objects, removing duplicates based on ID.
 * Prioritizes extensions from listB in case of conflict.
 * @param {Array<object>} listA - The first list of extensions.
 * @param {Array<object>} listB - The second list of extensions (takes priority).
 * @returns {Array<object>} A new array with merged, unique extensions.
 */
export function mergeExtensionLists(listA = [], listB = []) {
  const L_A = Array.isArray(listA) ? listA.filter(e => e && typeof e === 'object') : [];
  const L_B = Array.isArray(listB) ? listB.filter(e => e && typeof e === 'object') : [];

  const finalResult = [];
  const idToIndexMap = new Map();    // id -> index in finalResult
  const urlToIndexMap = new Map();   // homepageUrl -> index in finalResult

  [...L_A, ...L_B].forEach((currentExt, indexInCombinedArray) => {
    const isFromListB = indexInCombinedArray >= L_A.length;
    // It's crucial to work with a copy to avoid modifying original inputs directly during iteration,
    // especially if inputs could be used elsewhere or are results of previous operations.
    const currentExtCopy = JSON.parse(JSON.stringify(currentExt));


    let existingIdIndex = currentExtCopy.id ? idToIndexMap.get(currentExtCopy.id) : undefined;
    let existingUrlIndex = (currentExtCopy.homepageUrl && currentExtCopy.homepageUrl !== "") ? urlToIndexMap.get(currentExtCopy.homepageUrl) : undefined;

    let targetExtRef = null;
    let matchedIndex = -1;

    if (existingIdIndex !== undefined) {
      // Priority to ID match
      targetExtRef = finalResult[existingIdIndex];
      matchedIndex = existingIdIndex;
    } else if (existingUrlIndex !== undefined) {
      // Fallback to URL match if no ID match
      targetExtRef = finalResult[existingUrlIndex];
      matchedIndex = existingUrlIndex;
    }

    if (targetExtRef) { // Matched an existing entry
      const shouldCurrentBePreferred = isFromListB;

      const oldId = targetExtRef.id;
      const oldUrl = targetExtRef.homepageUrl;

      const baseExt = shouldCurrentBePreferred ? targetExtRef : currentExtCopy;
      const preferredExt = shouldCurrentBePreferred ? currentExtCopy : targetExtRef;

      const mergedExt = { ...baseExt }; // Start with base

      // Apply preferred values
      mergedExt.id = preferredExt.id || baseExt.id;
      mergedExt.name = (preferredExt.name !== undefined && preferredExt.name !== null) ? preferredExt.name : baseExt.name;
      mergedExt.homepageUrl = (preferredExt.homepageUrl !== undefined && preferredExt.homepageUrl !== null && preferredExt.homepageUrl !== "") ? preferredExt.homepageUrl : baseExt.homepageUrl;
      mergedExt.updateUrl = (preferredExt.updateUrl !== undefined && preferredExt.updateUrl !== null) ? preferredExt.updateUrl : baseExt.updateUrl;

      // Merge other properties, preferring 'preferredExt'
      for (const key in preferredExt) {
        if (preferredExt.hasOwnProperty(key) && !['id', 'name', 'homepageUrl', 'updateUrl'].includes(key)) {
          if (preferredExt[key] !== undefined) {
            mergedExt[key] = preferredExt[key];
          }
        }
      }
      // Ensure all original base keys are there if not in preferred and not undefined in base
      for (const key in baseExt) {
         if (baseExt.hasOwnProperty(key) && mergedExt[key] === undefined && baseExt[key] !== undefined) {
              mergedExt[key] = baseExt[key];
         }
      }
      
      finalResult[matchedIndex] = mergedExt;

      // Update maps if keys changed or if new keys should now point to this merged entry
      if (oldId !== mergedExt.id || (mergedExt.id && idToIndexMap.get(mergedExt.id) !== matchedIndex)) {
        if (oldId && idToIndexMap.get(oldId) === matchedIndex) {
          idToIndexMap.delete(oldId);
        }
        if (mergedExt.id) {
          // If another entry claimed this ID, it needs to be unlinked or resolved.
          // For now, last one wins the ID mapping.
          const conflictingIdxForNewId = idToIndexMap.get(mergedExt.id);
          if (conflictingIdxForNewId !== undefined && conflictingIdxForNewId !== matchedIndex) {
             // This means mergedExt.id was previously mapped to another item. That item loses its ID mapping.
             // This situation implies an ID conflict that should ideally be resolved by other means,
             // or the earlier item needs its ID cleared/changed if this merge takes precedence.
             // For simplicity here, the current merge wins the ID.
          }
          idToIndexMap.set(mergedExt.id, matchedIndex);
        }
      }

      if (oldUrl !== mergedExt.homepageUrl || (mergedExt.homepageUrl && mergedExt.homepageUrl !== "" && urlToIndexMap.get(mergedExt.homepageUrl) !== matchedIndex)) {
        if (oldUrl && oldUrl !== "" && urlToIndexMap.get(oldUrl) === matchedIndex) {
          urlToIndexMap.delete(oldUrl);
        }
        if (mergedExt.homepageUrl && mergedExt.homepageUrl !== "") {
          const conflictingIdxForNewUrl = urlToIndexMap.get(mergedExt.homepageUrl);
           if (conflictingIdxForNewUrl !== undefined && conflictingIdxForNewUrl !== matchedIndex) {
             // Similar to ID conflict, another item might lose its URL mapping.
           }
          urlToIndexMap.set(mergedExt.homepageUrl, matchedIndex);
        }
      }
      
      // If an ID was added to an entry that was previously only URL-matched and didn't have an ID
      if (!oldId && mergedExt.id && idToIndexMap.get(mergedExt.id) !== matchedIndex) {
          idToIndexMap.set(mergedExt.id, matchedIndex);
      }
      // If a URL was added to an entry that previously didn't have one
      if ((!oldUrl || oldUrl === "") && (mergedExt.homepageUrl && mergedExt.homepageUrl !== "") && urlToIndexMap.get(mergedExt.homepageUrl) !== matchedIndex) {
          urlToIndexMap.set(mergedExt.homepageUrl, matchedIndex);
      }


    } else { // New entry, no existing match by ID or URL
      finalResult.push(currentExtCopy);
      const newIndex = finalResult.length - 1;
      if (currentExtCopy.id) {
        idToIndexMap.set(currentExtCopy.id, newIndex);
      }
      if (currentExtCopy.homepageUrl && currentExtCopy.homepageUrl !== "") {
        urlToIndexMap.set(currentExtCopy.homepageUrl, newIndex);
      }
    }
  });

  return finalResult;
}
/**
 * Exports the bookmarks as a Netscape bookmark HTML file.
 * Recursively converts the bookmark tree to HTML.
 */
export async function exportBookmarksAsHtml() {
  try {
    // Get merged bookmarks from extension storage (not live browser bookmarks)
    const storedData = await getStoredData();
    let bookmarks = Array.isArray(storedData?.bookmarks) ? storedData.bookmarks : [];
    // If the structure matches the UI (array with root node and children), export only the children
    if (
      Array.isArray(bookmarks) &&
      bookmarks.length > 0 &&
      bookmarks[0] &&
      Array.isArray(bookmarks[0].children)
    ) {
      bookmarks = bookmarks[0].children.filter(
        node => !(node.title === "Managed bookmarks" && (!node.children || node.children.length === 0))
      );
    }

    // Helper to recursively convert bookmark nodes to HTML
    function bookmarksToHtml(nodes, depth = 1) {
      if (!Array.isArray(nodes)) return '';
      return nodes.map(node => {
        const indent = '  '.repeat(depth);
        if (node.url) {
          // Bookmark
          const title = node.title
            ? node.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            : "Bookmark";
          const url = node.url;
          const addDate = node.dateAdded
            ? Math.floor(node.dateAdded / 1000)
            : Math.floor(Date.now() / 1000);
          return `${indent}<DT><A HREF="${url}" ADD_DATE="${addDate}">${title}</A>`;
        } else if (node.children && node.title) {
          // Folder
          const title = node.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const addDate = node.dateAdded
            ? Math.floor(node.dateAdded / 1000)
            : Math.floor(Date.now() / 1000);
          return `${indent}<DT><H3 ADD_DATE="${addDate}">${title}</H3>\n${indent}<DL><p>\n${bookmarksToHtml(node.children, depth + 1)}\n${indent}</DL><p>`;
        }
        return '';
      }).join('\n');
    }

    const header = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

    const footer = `</DL><p>
`;

    const html = header + bookmarksToHtml(bookmarks) + '\n' + footer;

    // Trigger download
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarks_export_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error exporting bookmarks as HTML:", error);
    alert("Could not export bookmarks as HTML. See console for details.");
  }
}

/**
 * Exports the extension list as a Netscape bookmark HTML file.
 * Each extension with a homepageUrl is exported as a bookmark.
 */
export async function exportExtensionsAsBookmarks() {
  try {
    const storedData = await getStoredData();
    const extensions = Array.isArray(storedData?.extensions) ? storedData.extensions : [];
    // Only include extensions with a valid homepageUrl
    const bookmarkable = extensions.filter(
      ext => ext.homepageUrl && typeof ext.homepageUrl === 'string' && ext.homepageUrl.trim() !== ''
    );

    // Netscape Bookmark File Format
    const header = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Extensions as Bookmarks</TITLE>
<H1>Extensions as Bookmarks</H1>
<DL><p>
`;

    const footer = `</DL><p>
`;

    // Each extension as a bookmark
    const bookmarks = bookmarkable.map(ext => {
      // Escape HTML in name
      const title = ext.name
        ? ext.name.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">")
        : "Extension";
      const url = ext.homepageUrl;
      return `    <DT><A HREF="${url}" ADD_DATE="${Math.floor(Date.now() / 1000)}">${title}</A>`;
    }).join('\n');

    const html = header + bookmarks + '\n' + footer;

    // Trigger download
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extensions_bookmarks_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error exporting extensions as bookmarks:", error);
    alert("Could not export extensions as bookmarks. See console for details.");
  }
}