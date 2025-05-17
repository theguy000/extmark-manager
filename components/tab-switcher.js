// tab-switcher.js
// Manages tab navigation and UI state for the extension's interface, enabling users to switch between different views.
// Handles activation of tab content, updates button states, and toggles visibility of backup controls based on the selected tab.
// Provides setup functions for initializing tab button event listeners and ensuring smooth, interactive navigation.
// Tab Switcher Component

export function switchTab(targetTabId, tabButtons, tabContents) {
  tabContents.forEach(content => {
    content.classList.remove('active');
  });
  tabButtons.forEach(button => {
    button.classList.remove('active');
  });

  const activeContent = document.getElementById(`${targetTabId}-content`);
  const activeButton = Array.from(tabButtons).find(btn => btn.getAttribute('data-tab') === targetTabId);

  if (activeContent) activeContent.classList.add('active');
  if (activeButton) activeButton.classList.add('active');

  // --- Backup Controls Visibility ---
  // Show backup controls only when the backup tab is active.
  const backupControls = document.querySelector('.backup-controls'); // Find the controls div
  if (backupControls) {
    if (targetTabId === 'backup') {
      backupControls.style.display = 'flex'; // Show using flex as defined in CSS
    } else {
      backupControls.style.display = 'none'; // Hide for other tabs
    }
  }
}

export function setupTabButtons(tabButtons, tabContents, switchTabFn) {
  // Attach click listeners to each tab button, using the data-tab attribute to identify the target tab.
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      switchTabFn(tabId, tabButtons, tabContents);
    });
  });
}