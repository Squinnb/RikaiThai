// content.js — FINAL rikaikun-style matcher (single-paste version)
console.log("Thai Dictionary Extension loaded (rikaikun-style)");

/* -------------------------
   Globals / Config
   ------------------------- */

const TOOLTIP_ID = "thai-dict-tooltip";
const DICT_PATH = "thai_dict.json";

let DICT = null;
let DICT_DATA = null;
let DICT_BUCKETS = null;
let DICT_MAX_WORD_LEN = 0;
let DICT_LOADED = false;

let activeMatch = null;
let currentWord = null;

/* -------------------------
   Tooltip
   ------------------------- */

const tooltip = document.createElement("div");
let popupHovered = false;
let wordHovered = false;
let hidePopupTimeout = null;

const POPUP_OFFSET_X = 18;
const POPUP_OFFSET_Y = 20;

/* -------------------------
   Highlight system (unchanged)
   ------------------------- */

let activeHighlight = null;

function highlightWord(textNode, word, start, end) {
  removeHighlight();
  if (!textNode || textNode.nodeType !== 3) return;

  const text = textNode.nodeValue;
  if (!text || text.slice(start, end) !== word) return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const before = document.createTextNode(text.slice(0, start));
  const after = document.createTextNode(text.slice(end));

  const span = document.createElement("span");
  span.textContent = word;
  span.className = "thai-highlight-word";
  span.style.backgroundColor = "rgba(98, 172, 237, 0.75)";
  span.style.borderRadius = "4px";

  span.addEventListener("mouseenter", () => {
    wordHovered = true;
    if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  });

  span.addEventListener("mouseleave", () => {
    wordHovered = false;
    delayedHideTooltip();
  });

  parent.insertBefore(before, textNode);
  parent.insertBefore(span, textNode);
  parent.insertBefore(after, textNode);
  parent.removeChild(textNode);

  activeHighlight = { parent, before, span, after, textNode, text };
}

function removeHighlight() {
  if (!activeHighlight) return;

  const { parent, before, span, after, textNode, text } = activeHighlight;

  try {
    if (before.parentNode === parent) parent.removeChild(before);
    if (span.parentNode === parent) parent.removeChild(span);
    if (after.parentNode === parent) parent.removeChild(after);

    textNode.nodeValue = text;
    parent.appendChild(textNode);
  } catch {}

  activeHighlight = null;
}

/* -------------------------
   Tooltip helpers
   ------------------------- */

function initToolTip() {
  tooltip.id = TOOLTIP_ID;
  tooltip.style.position = "fixed";
  tooltip.style.background = "rgba(126, 126, 126, 0.95)";
  tooltip.style.color = "#fff";
  tooltip.style.border = "2px solidrgb(137, 222, 140)";
  tooltip.style.borderRadius = "6px";
  tooltip.style.padding = "6px";
  tooltip.style.fontSize = "16px";
  tooltip.style.zIndex = "2147483647";
  tooltip.style.display = "none";
  tooltip.style.pointerEvents = "auto";
  tooltip.style.maxWidth = "360px";

  tooltip.addEventListener("mouseenter", () => {
    popupHovered = true;
    if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  });

  tooltip.addEventListener("mouseleave", () => {
    popupHovered = false;
    delayedHideTooltip();
  });

  document.body.appendChild(tooltip);
}

function delayedHideTooltip() {
  if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  hidePopupTimeout = setTimeout(() => {
    if (!popupHovered && !wordHovered) hideTooltip();
  }, 120);
}

function hideTooltip() {
  tooltip.style.display = "none";
  removeHighlight();
  currentWord = null;
  activeMatch = null;
}

/* -------------------------
   Caret helper
   ------------------------- */

function getTextAroundCursor(event) {
  let pos = null;

  if (document.caretPositionFromPoint) {
    pos = document.caretPositionFromPoint(event.clientX, event.clientY);
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (range) pos = { offsetNode: range.startContainer, offset: range.startOffset };
  }

  if (!pos || !pos.offsetNode || pos.offsetNode.nodeType !== 3) return null;

  const text = pos.offsetNode.nodeValue;
  const offset = Math.min(pos.offset, text.length);

  const start = Math.max(0, offset - 50);
  const end = Math.min(text.length, offset + 50);

  return {
    textNode: pos.offsetNode,
    context: text.slice(start, end),
    absoluteOffset: offset,
    relativeOffset: offset - start
  };
}

/* -------------------------
   TRUE RIKAIKUN MATCHER
   ------------------------- */

function findMatchAt(context, cursorOffset) {
  const ctx = context.normalize("NFC");

  // 🔒 Keep current word if cursor still inside it
  if (
    activeMatch &&
    activeMatch.start < cursorOffset &&
    cursorOffset <= activeMatch.end &&
    ctx.slice(activeMatch.start, activeMatch.end) === activeMatch.word
  ) {
    return activeMatch;
  }

  let best = null;

  for (let start = cursorOffset; start >= Math.max(0, cursorOffset - 1); start--) {
    const bucket = DICT_BUCKETS.get(ctx.charAt(start));
    if (!bucket) continue;

    for (let len = DICT_MAX_WORD_LEN; len > 0; len--) {
      const end = start + len;
      if (end <= cursorOffset || end > ctx.length) continue;

      const word = ctx.slice(start, end);
      const entry = DICT_DATA[word];
      if (!entry) continue;

      if (
        !best ||
        start < best.start ||
        (start === best.start && word.length > best.word.length)
      ) {
        best = { word, entry, start, end };
      }
    }
  }

  activeMatch = best;
  return best;
}

/* -------------------------
   Dictionary loader
   ------------------------- */

async function loadDictionary() {
  const url = chrome.runtime.getURL(DICT_PATH);
  const resp = await fetch(url);
  DICT = await resp.json();
  DICT_DATA = DICT._data;

  DICT_BUCKETS = new Map();
  DICT_MAX_WORD_LEN = 0;

  for (const word of Object.keys(DICT_DATA)) {
    const w = word.normalize("NFC");
    DICT_MAX_WORD_LEN = Math.max(DICT_MAX_WORD_LEN, [...w].length);
    const c = w.charAt(0);
    if (!DICT_BUCKETS.has(c)) DICT_BUCKETS.set(c, new Set());
    DICT_BUCKETS.get(c).add(w);
  }

  DICT_LOADED = true;
  console.log("Dictionary loaded:", Object.keys(DICT_DATA).length);
}

/* -------------------------
   Mouse handler
   ------------------------- */

function mouseMove(event) {
  if (!DICT_LOADED) return;

  const data = getTextAroundCursor(event);
  if (!data || !/[\u0E00-\u0E7F]/.test(data.context)) return hideTooltip();

  const match = findMatchAt(data.context, data.relativeOffset);
  if (!match) return hideTooltip();

  if (currentWord === match.word) return;
  currentWord = match.word;

  const ctxStart = data.absoluteOffset - data.relativeOffset;
  highlightWord(
    data.textNode,
    match.word,
    ctxStart + match.start,
    ctxStart + match.end
  );

  const entry = match.entry;
  const defs = (entry.definitions || []).map(d => `<div>${escapeHtml(d)}</div>`).join("");

  tooltip.innerHTML = `
    <div style="color:#4CAF50;font-weight:bold">${match.word}</div>
    <div>${escapeHtml(entry.romanization_paiboon || "")}</div>
    ${defs}
  `;

  tooltip.style.display = "block";
  tooltip.style.left = `${event.clientX + POPUP_OFFSET_X}px`;
  tooltip.style.top = `${event.clientY + POPUP_OFFSET_Y}px`;
}

/* -------------------------
   Utils
   ------------------------- */

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* -------------------------
   Init
   ------------------------- */

async function init() {
  initToolTip();
  await loadDictionary();
  document.addEventListener("mousemove", mouseMove, true);
  document.addEventListener("mouseleave", hideTooltip);
}

init();
