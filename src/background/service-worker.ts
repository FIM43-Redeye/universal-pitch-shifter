/**
 * Service Worker (Background Script)
 *
 * Handles extension lifecycle, tab management, and message routing between
 * the popup and content scripts. Minimal by design - most logic lives in
 * the content script and popup.
 */

// Track which tabs have active pitch shifting
const activeTabs = new Set<number>();

// Handle extension icon click when popup is disabled
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Toggle the popup or inject content script as needed
  console.log("[UPS] Action clicked on tab:", tab.id);
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId ?? sender.tab?.id;

  switch (message.command) {
    case "get-state":
      // Return current state for a tab
      sendResponse({ active: activeTabs.has(tabId ?? -1) });
      break;

    case "activate":
      if (tabId) activeTabs.add(tabId);
      sendResponse({ success: true });
      break;

    case "deactivate":
      if (tabId) activeTabs.delete(tabId);
      sendResponse({ success: true });
      break;

    default:
      // Forward message to content script
      if (tabId) {
        chrome.tabs.sendMessage(tabId, message).catch(() => {
          // Tab might not have content script loaded
        });
      }
  }

  return true; // Keep message channel open for async response
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

console.log("[UPS] Service worker initialized");
