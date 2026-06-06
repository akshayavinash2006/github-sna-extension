# Implementation Plan - In-Page Integration & Visual Polish

This plan covers adding direct integration on GitHub pages (context menus and profile buttons) and upgrading the sidepanel visualization with shortest path animations, user profile cards, and search/zoom functionality.

## Proposed Changes

We will modify and create files across multiple layers.

### Manifest Configuration

#### [MODIFY] [manifest.json](file:///c:/Users/Akshay%20Avinash/Documents/PROJECTS/github-sna-extension/manifest.json)
- Add `"contextMenus"` to `permissions`.
- Add a `"content_scripts"` block to register `content.js` and `content.css` for `https://github.com/*`.

---

### Background Worker

#### [MODIFY] [background.js](file:///c:/Users/Akshay%20Avinash/Documents/PROJECTS/github-sna-extension/background.js)
- On extension install, create a context menu item: *"Analyze GitHub SNA Network"*.
- Listen to context menu clicks:
  - If a link or selected text is clicked, extract the GitHub username.
  - Open the side panel.
  - Save the target username to `chrome.storage.local` under `sna_pending_analysis` to trigger analysis.
- Listen to messages from content scripts:
  - If type is `TRIGGER_SNA_ANALYSIS`, open the side panel and write the pending analysis to storage.

---

### In-Page Content Script

#### [NEW] [content.js](file:///c:/Users/Akshay%20Avinash/Documents/PROJECTS/github-sna-extension/content.js)
- Runs on `github.com`.
- Checks if the page is a GitHub user profile by reading `meta[property="profile:username"]`.
- If on a profile page, dynamically inject a beautiful custom button next to the "Follow" button: *"SNA Analyze Network"*.
- Clicking this button sends a message to the background service worker to open the side panel and start the analysis.

#### [NEW] [content.css](file:///c:/Users/Akshay%20Avinash/Documents/PROJECTS/github-sna-extension/content.css)
- Contains premium styling for the injected SNA button to match GitHub's native style guide with a subtle green/blue gradient hover state.

---

### Side Panel UI & Styling

#### [MODIFY] [panel.html](file:///c:/Users/Akshay%20Avinash/Documents/PROJECTS/github-sna-extension/sidepanel/panel.html)
- Load `panel.js` as an ES module: `<script type="module" src="panel.js"></script>`.
- Add a search input `#search-nodes` at the top of the sidebar.
- Add an overlay `#loadingOverlay` for loading indicators during direct analysis.
- Add a user details card `#details-card` at the bottom of the sidebar.
- Add CSS animations for neon path glowing (`.active-path-link` with `stroke-dasharray` animation) and loading spinner.

#### [MODIFY] [panel.js](file:///c:/Users/Akshay%20Avinash/Documents/PROJECTS/github-sna-extension/sidepanel/panel.js)
- Import API functions (`getUser`, `getStarredRepos`, etc.) and graph algorithms directly to allow running analysis in the sidepanel.
- Listen for `chrome.storage.onChanged` or check startup storage for `sna_pending_analysis` to auto-trigger the analysis loop with a loading overlay.
- Implement Search & Pan:
  - Typing in `#search-nodes` filters the node list.
  - Selecting/panning to a node applies smooth D3 transition zooming (`d3.zoomIdentity.translate(...).scale(1.5)`).
- Implement Pulsing & Neon Trail for Paths:
  - Update `findPath` to apply the class `.active-path-link` to links on the path.
  - Update node styling to increase size, outline thickness, and glow when they are part of the path.
- Implement User Details Card:
  - Clicking on a node shows the card and populates it with cached graph data.
  - Triggers an async API call to fetch full profile details (bio, name, followers, public repos) and updates the details card.
  - Wires up the "ANALYZE USER" button in the card to run analysis for that node.

---

## Verification Plan

### Manual Verification
- Reload the extension.
- **Context Menu**: Go to a repo page, right-click a contributor's avatar or link, select "Analyze GitHub SNA Network". Verify side panel opens and starts analysis.
- **In-Page Button**: Go to `https://github.com/torvalds`. Verify the "SNA Analyze Network" button is injected. Click it, check that it opens side panel and triggers analysis.
- **Visual Path Pulse**: Find a path between two nodes in the side panel. Verify that the path links highlight in neon blue/orange and pulse.
- **User Details & Search**: Search for a node, click on it, check that the SVG zooms in and centers. Verify the sidebar card fetches and displays their bio/stats, and clicking "Analyze User" starts a new analysis loop.
