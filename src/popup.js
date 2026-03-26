const THEMES = ["Thai Flag", "midnight", "high-contrast"];

function setActive(theme) {
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

// Load saved state
chrome.storage.sync.get(["theme", "enabled"], ({ theme, enabled }) => {
  if (theme) setActive(theme);
  document.getElementById("enableToggle").checked = enabled !== false; // default on
});

// Theme buttons
document.querySelectorAll(".theme-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme;
    chrome.storage.sync.set({ theme });
    setActive(theme);
  });
});

// Enable/disable toggle
document.getElementById("enableToggle").addEventListener("change", (e) => {
  chrome.storage.sync.set({ enabled: e.target.checked });
});