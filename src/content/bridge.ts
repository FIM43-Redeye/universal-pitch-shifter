/**
 * Content Script Bridge
 *
 * Runs in ISOLATED world to handle chrome.runtime messaging,
 * then forwards to MAIN world via CustomEvents.
 *
 * Also provides extension URLs to MAIN world (which can't access chrome.runtime).
 */

// Send extension base URL to MAIN world
// This is needed because MAIN world can't access chrome.runtime.getURL
// We use BOTH a data attribute (survives timing issues) AND an event (for immediate notification)
const extensionBaseUrl = chrome.runtime.getURL('');

// Set data attribute on documentElement (accessible from MAIN world)
// Wait for documentElement to exist if needed
function setExtensionUrlAttribute() {
  if (document.documentElement) {
    document.documentElement.dataset.upsExtensionUrl = extensionBaseUrl;
    window.dispatchEvent(new CustomEvent('ups-extension-url', {
      detail: { baseUrl: extensionBaseUrl }
    }));
  } else {
    // Retry until documentElement exists
    setTimeout(setExtensionUrlAttribute, 1);
  }
}
setExtensionUrlAttribute();

// Forward messages from popup/background to MAIN world
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Create a unique ID for this request
  const requestId = `ups-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Listen for the response
  const handleResponse = (event: Event) => {
    const customEvent = event as CustomEvent;
    if (customEvent.detail?.requestId === requestId) {
      window.removeEventListener('ups-response', handleResponse);
      sendResponse(customEvent.detail.response);
    }
  };

  window.addEventListener('ups-response', handleResponse);

  // Forward the message to MAIN world
  window.dispatchEvent(new CustomEvent('ups-message', {
    detail: { message, requestId }
  }));

  // Return true to indicate async response
  return true;
});

console.log('[UPS Bridge] Message bridge ready');
