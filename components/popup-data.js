// popup-data.js
// Handles data loading, merging, filtering, browser detection, and backup/restore logic for the popup

import { displayExtensions, getStoreUrl } from './extension-display.js';
import { displayBookmarks } from './bookmark-display.js';
import { exportAllData, importAllData, SCHEMA_VERSION, mergeExtensionLists, mergeBookmarkTrees, exportExtensionsAsBookmarks, exportBookmarksAsHtml } from './data-handler.js';
import { switchTab, setupTabButtons } from './tab-switcher.js';
import { initializeBackupFeature, performPantryRestore } from './backup-feature.js';

// --- Global storage for full data (needed for filtering) ---
export let fullExtensionList = [];
export let fullBookmarkTree = [];

/**
 * Loads data from chrome.storage.local.importedDataList and updates the UI.
 * If no data is found, it loads the currently installed extensions and bookmarks.
 */
export async function loadAndDisplayImportedData(extensionList, bookmarksTreeContainer, switchTabFunc, browserName, shouldSaveMergedData = false) {
  const result = await new Promise((resolve, reject) => {
    chrome.storage.local.get('importedDataList', (data) => {
      if (chrome.runtime.lastError) {
        console.error("Storage get error:", chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve(data);
      }
    });
  });

  const importedData = result.importedDataList;

  // Load live extensions
  let liveExtensions = [];
  try {
    liveExtensions = await new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.management || !chrome.management.getAll) {
        console.warn("Extension management API unavailable");
        return resolve([]);
      }
      chrome.management.getAll(function(extensions) {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(extensions.filter(ext => ext.type === 'extension'));
      });
    });
  } catch (err) {
    console.error("Error fetching installed extensions:", err);
  }

  // Load live bookmarks
  let liveBookmarks = [];
  try {
    liveBookmarks = await new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.bookmarks.getTree) {
        console.warn("Bookmarks API unavailable");
        return resolve([]);
      }
      chrome.bookmarks.getTree(function(bookmarkTreeNodes) {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(bookmarkTreeNodes);
      });
    });
  } catch (err) {
    console.error("Error fetching bookmarks:", err);
  }

  let extensionsToDisplay = liveExtensions;
  let bookmarksToDisplay = liveBookmarks;

  // If we have imported data, merge it with live data
  if (importedData) {
    if (importedData.extensions && Array.isArray(importedData.extensions)) {
      const simplifiedLiveExtensions = liveExtensions.map(ext => ({
        id: ext.id,
        name: ext.name,
        homepageUrl: ext.homepageUrl,
        updateUrl: ext.updateUrl
      }));
      extensionsToDisplay = mergeExtensionLists(importedData.extensions, simplifiedLiveExtensions);
    }
    if (importedData.bookmarks && Array.isArray(importedData.bookmarks)) {
      bookmarksToDisplay = mergeBookmarkTrees(importedData.bookmarks, liveBookmarks);
    }
    if (shouldSaveMergedData) {
      const mergedData = {
        schemaVersion: importedData.schemaVersion || SCHEMA_VERSION,
        exportedTimestamp: new Date().toISOString(),
        exportedFromBrowser: browserName,
        extensions: extensionsToDisplay,
        bookmarks: bookmarksToDisplay
      };
      chrome.storage.local.set({ importedDataList: mergedData }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving merged data:", chrome.runtime.lastError);
        } else {
          console.log("Merged data saved to storage");
        }
      });
    }
  }

  // Store the full lists for filtering
  fullExtensionList = [...extensionsToDisplay];
  fullBookmarkTree = [...bookmarksToDisplay];

  // Display extensions
  if (extensionsToDisplay && extensionsToDisplay.length > 0) {
    await displayExtensions({
      extensionList,
      extensionsToDisplay,
      currentContextBrowserName: browserName
    });
    if (typeof switchTabFunc === 'function') {
      switchTabFunc('extensions');
    }
  } else {
    extensionList.innerHTML = '<li class="empty-text">No extensions found.</li>';
  }

  // Display bookmarks
  if (bookmarksToDisplay && bookmarksToDisplay.length > 0) {
    displayBookmarks(bookmarksTreeContainer, bookmarksToDisplay);
  } else {
    bookmarksTreeContainer.innerHTML = '<p class="empty-text">No bookmarks found.</p>';
  }
}

/**
 * Browser detection logic
 */
export function getBrowserInfo() {
  const navigator = window.navigator;
  const ua = navigator.userAgent.toLowerCase();
  let browserName = "Unknown";
  let browserVersion = "N/A";

  if (window.brave && typeof window.brave.isBrave === 'function') {
    browserName = "Brave";
  }
  if (navigator.userAgentData && navigator.userAgentData.brands) {
    const brands = navigator.userAgentData.brands;
    const braveBrand = brands.find(b => b.brand.toLowerCase() === "brave");
    if (braveBrand) {
      browserName = "Brave";
      browserVersion = braveBrand.version;
      return { name: browserName, version: "N/A" };
    }
    const edgeBrand = brands.find(b => b.brand.toLowerCase() === "microsoft edge");
    if (edgeBrand) {
      browserName = "Edge";
      browserVersion = edgeBrand.version;
      return { name: browserName, version: "N/A" };
    }
    const operaBrand = brands.find(b => b.brand.toLowerCase() === "opera");
    if (operaBrand) {
      browserName = "Opera";
      browserVersion = operaBrand.version;
      return { name: browserName, version: "N/A" };
    }
    const vivaldiBrand = brands.find(b => b.brand.toLowerCase() === "vivaldi");
    if (vivaldiBrand) {
      browserName = "Vivaldi";
      browserVersion = vivaldiBrand.version;
      return { name: browserName, version: "N/A" };
    }
    const chromeBrand = brands.find(b => b.brand.toLowerCase() === "google chrome" || b.brand.toLowerCase() === "chrome");
    if (chromeBrand) {
      if (browserName === "Unknown" || browserName === "Brave") {
        browserName = "Chrome";
        browserVersion = chromeBrand.version;
        return { name: browserName, version: "N/A" };
      }
    }
    if (browserName === "Brave" && browserVersion === "N/A") {
      const chromiumBrandForBrave = brands.find(b => b.brand.toLowerCase() === "chromium");
      if (chromiumBrandForBrave) browserVersion = chromiumBrandForBrave.version;
      return { name: browserName, version: "N/A", source: "window.brave + userAgentData" };
    }
  }
  try {
    if (typeof InstallTrigger !== 'undefined' || ua.includes("firefox/")) {
      browserName = "Firefox";
      browserVersion = ua.match(/firefox\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("edg/")) {
      browserName = "Edge";
      browserVersion = ua.match(/edg\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("edge/")) {
      browserName = "Edge (Legacy)";
      browserVersion = ua.match(/edge\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("opr/") || ua.includes("opera")) {
      browserName = "Opera";
      browserVersion = ua.match(/(?:opr|opera)[\s/]([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("vivaldi/")) {
      browserName = "Vivaldi";
      browserVersion = ua.match(/vivaldi\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("samsungbrowser/")) {
      browserName = "Samsung Browser";
      browserVersion = ua.match(/samsungbrowser\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("ucbrowser/")) {
      browserName = "UC Browser";
      browserVersion = ua.match(/ucbrowser\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("qqbrowser/")) {
      browserName = "QQ Browser";
      browserVersion = ua.match(/qqbrowser\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("safari/") && !ua.includes("chrome/") && !ua.includes("chromium/") && !ua.includes("edg/")) {
      if (typeof safari !== 'undefined' && safari.pushNotification) {
        browserName = "Safari";
        browserVersion = ua.match(/version\/([\d.]+)/)?.[1] || ua.match(/safari\/([\d.]+)/)?.[1] || "N/A";
      } else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
        browserName = "Safari (iOS)";
        browserVersion = ua.match(/version\/([\d.]+)/)?.[1] || ua.match(/os ([\d_]+)/)?.[1].replace(/_/g, '.') || "N/A";
      } else {
        browserName = "Safari (or WebKit)";
        browserVersion = ua.match(/version\/([\d.]+)/)?.[1] || ua.match(/safari\/([\d.]+)/)?.[1] || "N/A";
      }
    } else if (ua.includes("chrome/") && !ua.includes("chromium/")) {
      if (browserName === "Unknown" || (browserName === "Brave" && browserVersion === "N/A")) {
        browserName = "Chrome";
        browserVersion = ua.match(/chrome\/([\d.]+)/)?.[1] || "N/A";
      }
    } else if (ua.includes("chromium/")) {
      browserName = "Chromium";
      browserVersion = ua.match(/chromium\/([\d.]+)/)?.[1] || "N/A";
    } else if (ua.includes("msie ") || ua.includes("trident/")) {
      browserName = "Internet Explorer";
      browserVersion = ua.match(/(?:msie |rv:)([\d.]+)/)?.[1] || "N/A";
    }
  } catch (e) {
    console.error("Error during browser detection (UA fallback):", e);
  }
  if (browserName === "Brave" && browserVersion === "N/A") {
    browserVersion = ua.match(/chrome\/([\d.]+)/)?.[1] || "N/A";
    return { name: browserName, version: browserVersion, source: "window.brave + UA Fallback" };
  }
  return {
    name: browserName,
    version: browserVersion,
    source: (browserName !== "Unknown" && browserVersion !== "N/A") ? "UA Fallback" : "Unknown",
    userAgent: navigator.userAgent
  };
}

/**
 * Filtering logic for extensions
 */
export function filterExtensions(searchTerm, extensionList, currentBrowserName) {
  const lowerCaseSearchTerm = searchTerm.toLowerCase().trim();
  if (!lowerCaseSearchTerm) {
    displayExtensions({
      extensionList,
      extensionsToDisplay: fullExtensionList,
      currentContextBrowserName: currentBrowserName
    });
    return;
  }
  const filteredExtensions = fullExtensionList.filter(ext =>
    ext.name.toLowerCase().includes(lowerCaseSearchTerm)
  );
  displayExtensions({
    extensionList,
    extensionsToDisplay: filteredExtensions,
    currentContextBrowserName: currentBrowserName
  });
}

/**
 * Recursively filters bookmark nodes based on search term (title or URL).
 */
export function filterBookmarkNodes(nodes, lowerCaseSearchTerm) {
  return nodes.map(node => {
    if (node.url) {
      const titleMatch = node.title.toLowerCase().includes(lowerCaseSearchTerm);
      const urlMatch = node.url.toLowerCase().includes(lowerCaseSearchTerm);
      return (titleMatch || urlMatch) ? node : null;
    }
    if (node.children) {
      const filteredChildren = filterBookmarkNodes(node.children, lowerCaseSearchTerm);
      if (node.title.toLowerCase().includes(lowerCaseSearchTerm) || filteredChildren.some(child => child !== null)) {
        return { ...node, children: filteredChildren.filter(child => child !== null) };
      }
    }
    return null;
  }).filter(node => node !== null);
}

/**
 * Filtering logic for bookmarks
 */
export function filterBookmarks(searchTerm, bookmarksTreeContainer) {
  const lowerCaseSearchTerm = searchTerm.toLowerCase().trim();
  if (!lowerCaseSearchTerm) {
    displayBookmarks(bookmarksTreeContainer, fullBookmarkTree);
    return;
  }
  const filteredTree = filterBookmarkNodes(fullBookmarkTree, lowerCaseSearchTerm);
  displayBookmarks(bookmarksTreeContainer, filteredTree);
}

/**
 * Pantry restore handler
 */
export async function handlePantryRestore(restorePantryButton, extensionList, bookmarksTreeContainer, switchTabWrapper, currentBrowserName) {
  if (!restorePantryButton) return;
  const successCallback = () => {
    loadAndDisplayImportedData(extensionList, bookmarksTreeContainer, switchTabWrapper, currentBrowserName, true);
  };
  await performPantryRestore(restorePantryButton, successCallback);
}