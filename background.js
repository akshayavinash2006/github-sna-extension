// background.js — service worker
// Enables side panel and setups context menu handlers

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Setup context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyze-user-sna",
    title: "Analyze GitHub SNA Network",
    contexts: ["link", "selection"]
  });
});

// Helper to open sidepanel and request analysis
function openSidePanelAndAnalyze(username) {
  chrome.windows.getCurrent({}, (win) => {
    chrome.sidePanel.open({ windowId: win.id }, () => {
      // Set a timestamped pending analysis so side panel executes it
      chrome.storage.local.set({
        sna_pending_analysis: {
          username: username.trim(),
          timestamp: Date.now()
        }
      });
    });
  });
}

// Context Menu clicks handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyze-user-sna") {
    let username = "";
    if (info.selectionText) {
      username = info.selectionText.trim().replace(/^@/, "");
    } else if (info.linkUrl) {
      // Parse username from URL, ignoring subfolders/subpages
      try {
        const url = new URL(info.linkUrl);
        if (url.hostname === "github.com") {
          const parts = url.pathname.split("/").filter(Boolean);
          if (parts.length > 0) {
            username = parts[0];
          }
        }
      } catch (e) {
        console.error("Failed to parse link URL:", e);
      }
    }

    const ignored = ["settings", "pulls", "issues", "notifications", "marketplace", "explore", "trending", "stars", "search", "orgs"];
    if (username && !ignored.includes(username.toLowerCase())) {
      openSidePanelAndAnalyze(username);
    }
  }
});

// Runtime messages handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_SIDE_PANEL') {
    chrome.windows.getCurrent({}, (win) => {
      chrome.sidePanel.open({ windowId: win.id }, () => {
        sendResponse({ ok: true });
      });
    });
    return true; // keep channel open for async response
  }

  if (msg.type === 'TRIGGER_SNA_ANALYSIS') {
    if (msg.username) {
      openSidePanelAndAnalyze(msg.username);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "No username provided" });
    }
    return true;
  }
});
