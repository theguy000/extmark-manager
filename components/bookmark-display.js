// bookmark-display.js
// Renders the browser's bookmark tree as interactive UI elements, supporting both bookmarks and folders.
// Handles bookmark and folder deletion, updates the UI in real time, and manages error states.
// Provides functions to display the full bookmark tree and ensure a responsive, user-friendly experience.
// Bookmark Display Component
import { getFaviconUrl, DEFAULT_FAVICON_SVG } from './extension-display.js';
import { removeBookmarkById } from './data-handler.js';

export function renderBookmarkNode(node) {
  const listItem = document.createElement('li');
  listItem.classList.add('bookmark-item');

  const contentDiv = document.createElement('div');
  contentDiv.classList.add('node-content');

  if (node.url) { // It's a bookmark
    listItem.classList.add('bookmark');
    const favicon = document.createElement('img');
    favicon.src = getFaviconUrl(node.url);
    favicon.classList.add('favicon');
    favicon.alt = '';
    favicon.onerror = function() { this.src = DEFAULT_FAVICON_SVG; };

    const link = document.createElement('a');
    link.href = node.url;
    link.textContent = node.title || '(No Title)';
    link.title = `${node.title || ''}\n${node.url}`;
    link.target = '_blank';

    contentDiv.appendChild(favicon);
    contentDiv.appendChild(link);

    // Add delete button only if node.id exists
    if (node.id) {
      const deleteBtn = document.createElement('button');
      deleteBtn.classList.add('delete-bookmark-button');
      deleteBtn.title = 'Delete bookmark';
      deleteBtn.innerHTML = '<img src="icons/trash.svg" alt="Delete" class="icon">';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (confirm('Delete this bookmark?')) {
          try {
            await removeBookmarkById(node.id);
            listItem.remove();
          } catch (err) {
            if (err.message === "This bookmark or folder no longer exists.") {
              alert(err.message);
              // Refresh the bookmark tree in the UI
              chrome.bookmarks.getTree((tree) => {
                const container = document.querySelector('.bookmarks-tree-container');
                if (container) {
                  displayBookmarks(container, tree);
                }
              });
            } else {
              alert('Failed to delete bookmark: ' + err.message);
            }
          }
        }
      });
      contentDiv.appendChild(deleteBtn);
    }

  } else { // It's a folder
    listItem.classList.add('folder');

    const toggle = document.createElement('span');
    toggle.classList.add('folder-toggle');
    contentDiv.appendChild(toggle);

    const favicon = document.createElement('img');
    favicon.src = getFaviconUrl(null);
    favicon.classList.add('favicon');
    favicon.alt = 'Folder';
    contentDiv.appendChild(favicon);

    const titleSpan = document.createElement('span');
    titleSpan.classList.add('folder-title');
    titleSpan.textContent = node.title || '(Unnamed Folder)';
    contentDiv.appendChild(titleSpan);

    // Add delete button for folders only if node.id exists and not a special/root folder
    // Only allow deletion for user-created folders, not special/root folders.
    if (
      node.id &&
      node.title !== 'Bookmarks Bar' &&
      node.title !== 'Other Bookmarks' &&
      node.title !== 'Managed bookmarks'
    ) {
      const deleteBtn = document.createElement('button');
      deleteBtn.classList.add('delete-bookmark-button');
      deleteBtn.title = 'Delete folder';
      deleteBtn.innerHTML = '<img src="icons/trash.svg" alt="Delete" class="icon">';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (confirm('Delete this folder and all its contents?')) {
          try {
            await removeBookmarkById(node.id);
            listItem.remove();
          } catch (err) {
            if (err.message === "This bookmark or folder no longer exists.") {
              alert(err.message);
              // If the folder no longer exists, refresh the bookmark tree in the UI
              chrome.bookmarks.getTree((tree) => {
                const container = document.querySelector('.bookmarks-tree-container');
                if (container) {
                  displayBookmarks(container, tree);
                }
              });
            } else {
              alert('Failed to delete folder: ' + err.message);
            }
          }
        }
      });
      contentDiv.appendChild(deleteBtn);
    }

    // Toggle folder open/close on click, but not when clicking a bookmark link.
    contentDiv.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A') {
        listItem.classList.toggle('open');
      }
    });

    if (node.children && node.children.length > 0) {
      const childrenList = document.createElement('ul');
      childrenList.classList.add('bookmarks-list');
      node.children.forEach(child => {
        childrenList.appendChild(renderBookmarkNode(child));
      });
      listItem.appendChild(childrenList);
    } else {
      toggle.style.visibility = 'hidden';
    }
  }
  listItem.prepend(contentDiv);
  return listItem;
}

export function displayBookmarks(bookmarksTreeContainer, bookmarkNodes) {
  bookmarksTreeContainer.innerHTML = '';

  if (!bookmarkNodes || bookmarkNodes.length === 0) {
    bookmarksTreeContainer.innerHTML = '<p class="empty-text">No bookmarks found or loaded.</p>';
    return;
  }

  const rootList = document.createElement('ul');
  rootList.classList.add('bookmarks-list', 'root-level');

  if (bookmarkNodes[0] && bookmarkNodes[0].children) {
    bookmarkNodes[0].children.forEach(node => {
      // Skip empty "Managed bookmarks" node, as it is a special system folder.
      if (node.title === "Managed bookmarks" && (!node.children || node.children.length === 0)) {
        return;
      }
      rootList.appendChild(renderBookmarkNode(node));
    });
  } else {
    bookmarksTreeContainer.innerHTML = '<p class="empty-text">Bookmark tree structure seems invalid.</p>';
    return;
  }

  bookmarksTreeContainer.appendChild(rootList);
}