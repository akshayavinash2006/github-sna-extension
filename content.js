// content.js — runs on github.com profile pages
// Injects the SNA button and communicates with background.js

function getProfileUsername() {
  return document.querySelector('meta[property="profile:username"]')?.content;
}

function injectSNAButton() {
  const username = getProfileUsername();
  if (!username) return;

  // Check if button already exists
  if (document.getElementById('github-sna-btn')) return;

  // Locate the target container (Editable area or names section)
  // These classes are standard on user profile sidebars
  const target = document.querySelector('.js-profile-editable-area') || 
                 document.querySelector('.vcard-names-container') ||
                 document.querySelector('.js-profile-editable-replace');
  
  if (!target) return;

  // Create the action button
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

  btn.addEventListener('click', () => {
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `
      <svg class="octicon octicon-graph sna-btn-icon spin" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="animation: spin 1s linear infinite;">
        <path d="M8 12a4 4 0 1 1 4-4v1h1V8a5 5 0 1 0-5 5v1h1v-1a4 4 0 0 1-1-1Zm0-7a3 3 0 1 0 3 3V7H9v1h2v1H9a3 3 0 0 0-1-6Z"/>
      </svg>
      Analyzing...
    `;
    
    chrome.runtime.sendMessage({
      type: 'TRIGGER_SNA_ANALYSIS',
      username: username
    }, (response) => {
      // Re-enable and reset after brief delay to let side panel open
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }, 1000);
    });
  });

  // Insert inside target container
  target.appendChild(btn);
}

// Initial Run
injectSNAButton();

// Setup MutationObserver to handle pjax/turbo page changes
const observer = new MutationObserver(() => {
  injectSNAButton();
});
observer.observe(document.body, { childList: true, subtree: true });
