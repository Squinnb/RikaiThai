console.log("RikaiThai content script loaded");

// Example: Simple tooltip logic (expand as needed)
document.addEventListener("mouseover", (e) => {
  const text = e.target.innerText || "";
  if (!/[\u0E00-\u0E7F]/.test(text)) return; // contains Thai chars?

  // Very basic demo: show alert for first Thai word (replace with wordcut logic)
  alert(`You hovered over Thai text: ${text}`);
});
