// content.js — runs on github.com profile pages
// Injects the SNA button and communicates with background.js

function getProfileUsername() {
  return document.querySelector('meta[property="profile:username"]')?.content;
}

function injectSNAButton() {
  const username = getProfileUsername();
  if (!username) return;

  if (document.getElementById('github-sna-btn')) return;

  const target = document.querySelector('.js-profile-editable-area') ||
                 document.querySelector('.vcard-names-container') ||
                 document.querySelector('.js-profile-editable-replace');

  if (!target) return;

  const btn = document.createElement('button');
  btn.id = 'github-sna-btn';
  btn.className = 'btn btn-block sna-btn-custom';
  btn.type = 'button';
  btn.innerHTML = `
    <svg class="octicon octicon-graph sna-btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M11 14a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-2.5-3.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H10v.5a.5.5 0 0 1-1 0v-.5ZM13 14a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-.5-3.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-1v.5a.5.5 0 0 1-1 0v-.5ZM5 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-2.5 3.5v.5H3V7a.5.5 0 0 1 1 0v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h.5v-.5a.5.5 0 0 1 0-1ZM7 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-.5 3.5v.5H7V7a.5.5 0 0 1 1 0v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h.5v-.5a.5.5 0 0 1 0-1ZM8 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm1.5-3.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H11v.5a.5.5 0 0 1-1 0v-.5Z"/>
      <path fill-rule="evenodd" d="M1.5 1.75a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-1.5 0V2.5a.75.75 0 0 1 .75-.75Zm13 0a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-1.5 0V2.5a.75.75 0 0 1 .75-.75ZM3 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm10-6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM7 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>
    </svg>
    SNA Analyze Network
  `;

  // Track per-button whether the context died on a previous click
  let dead = false;

  btn.addEventListener('click', () => {
    if (dead) {
      btn.innerHTML = '⚠ Reload page to reconnect';
      btn.disabled = true;
      return;
    }

    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `
      <svg class="octicon octicon-graph sna-btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="animation:spin 1s linear infinite;">
        <path d="M8 12a4 4 0 1 1 4-4v1h1V8a5 5 0 1 0-5 5v1h1v-1a4 4 0 0 1-1-1Zm0-7a3 3 0 1 0 3 3V7H9v1h2v1H9a3 3 0 0 0-1-6Z"/>
      </svg>
      Analyzing...
    `;

    try {
      chrome.runtime.sendMessage(
        { type: 'TRIGGER_SNA_ANALYSIS', username },
        () => {
          // Swallow runtime.lastError so Chrome doesn't log an unchecked error
          void chrome.runtime.lastError;
          setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalContent;
          }, 1000);
        }
      );
    } catch (_) {
      // Extension was reloaded while this tab was open — context is gone.
      // Mark as dead so future clicks don't retry.
      dead = true;
      btn.innerHTML = '⚠ Reload page to reconnect';
      // keep btn.disabled = true
    }
  });

  target.appendChild(btn);
}

// Initial injection
injectSNAButton();

// Watch for GitHub pjax/Turbo navigations (no-reload tab transitions).
// Wraps callback in try-catch so a dead context doesn't surface errors here.
const observer = new MutationObserver(() => {
  try {
    injectSNAButton();
  } catch (_) {
    // Context invalidated — stop observing silently
    observer.disconnect();
  }
});
observer.observe(document.body, { childList: true, subtree: true });
