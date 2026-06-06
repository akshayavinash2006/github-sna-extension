// background.js — service worker
// Enables side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_SIDE_PANEL') {
    chrome.windows.getCurrent({}, (win) => {
      chrome.sidePanel.open({ windowId: win.id }, () => {
        sendResponse({ ok: true });
      });
    });
    return true; // keep channel open for async response
  }
});
