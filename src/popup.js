const THEMES = ["Thailand", "midnight", "high-contrast"];

function setActive(theme) {
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

// Load current theme and mark active
chrome.storage.sync.get("theme", ({ theme }) => {
  if (theme) setActive(theme);
});


document.querySelectorAll(".theme-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme;
    console.log('theme selected: ', theme)
    chrome.storage.sync.set({ theme });
    setActive(theme);

    // Notify content script to update
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "SET_THEME", theme });
    });
  });
});