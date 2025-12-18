// content.js — TRUE RIKAIKUN-STYLE IMPLEMENTATION (FINAL)
console.log("Thai Dictionary Extension loaded — TRUE Rikaikun mode");

/* ============================================================
   CONFIG / GLOBALS
   ============================================================ */

const TOOLTIP_ID = "thai-dict-tooltip";
const HIGHLIGHT_ID = "__thai_dict_highlight_overlay";
const DICT_PATH = "thai_dict.json";

const POPUP_OFFSET_X = 18;
const POPUP_OFFSET_Y = 20;

let DICT_DATA = null;
let DICT_BUCKETS = null;
let DICT_MAX_WORD_LEN = 0;
let DICT_LOADED = false;

let currentMatchKey = null;

/* ============================================================
   TOOLTIP
   ============================================================ */

const tooltip = document.createElement("div");
let popupHovered = false;
let hidePopupTimeout = null;

function initTooltip() {
  tooltip.id = TOOLTIP_ID;
  tooltip.style.position = "fixed";
  tooltip.style.background = "rgba(0,0,0,0.95)";
  tooltip.style.color = "white";
  tooltip.style.border = "2px solid #4CAF50";
  tooltip.style.borderRadius = "6px";
  tooltip.style.padding = "4px 6px";
  tooltip.style.fontSize = "18px";
  tooltip.style.fontFamily =
    "thongterm, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial";
  tooltip.style.zIndex = "2147483647";
  tooltip.style.display = "none";
  tooltip.style.pointerEvents = "auto";
  tooltip.style.maxWidth = "360px";
  tooltip.style.wordBreak = "break-word";

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
    if (!popupHovered) hideTooltip();
  }, 120);
}

/* ============================================================
   SAFE OVERLAY HIGHLIGHT (RANGE-BASED)
   ============================================================ */

let highlightDiv = null;

function initHighlightOverlay() {
  highlightDiv = document.createElement("div");
  highlightDiv.id = HIGHLIGHT_ID;
  highlightDiv.style.position = "fixed";
  highlightDiv.style.background = "rgba(98, 172, 237, 0.45)";
  highlightDiv.style.outline = "1px solid rgb(0, 31, 49)";
  highlightDiv.style.borderRadius = "4px";
  highlightDiv.style.pointerEvents = "none";
  highlightDiv.style.zIndex = "2147483646";
  highlightDiv.style.display = "none";
  document.body.appendChild(highlightDiv);
}

function clearHighlight() {
  if (highlightDiv) highlightDiv.style.display = "none";
}

function highlightRange(textNode, start, end) {
  const range = document.createRange();
  try {
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
  } catch {
    return;
  }

  const rects = range.getClientRects();
  if (!rects || rects.length === 0) return;

  const r = rects[0];
  highlightDiv.style.left = `${r.left}px`;
  highlightDiv.style.top = `${r.top}px`;
  highlightDiv.style.width = `${r.width}px`;
  highlightDiv.style.height = `${r.height}px`;
  highlightDiv.style.display = "block";
}

/* ============================================================
   CARET TEXT EXTRACTION
   ============================================================ */

function getCaretText(event) {
  let pos = null;

  if (document.caretPositionFromPoint) {
    pos = document.caretPositionFromPoint(event.clientX, event.clientY);
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (r) pos = { offsetNode: r.startContainer, offset: r.startOffset };
  }

  if (!pos || !pos.offsetNode) return null;

  let textNode = pos.offsetNode;
  if (textNode.nodeType !== 3) {
    const walker = document.createTreeWalker(textNode, NodeFilter.SHOW_TEXT);
    textNode = walker.nextNode();
    if (!textNode) return null;
  }

  const text = textNode.nodeValue;
  if (!text) return null;

  const offset = Math.min(pos.offset, text.length);
  return { textNode, text, offset };
}

/* ============================================================
   DICTIONARY LOADING (PRECOMPUTED)
   ============================================================ */

async function loadDictionary() {
  if (DICT_LOADED) return;

  const url = chrome?.runtime?.getURL
    ? chrome.runtime.getURL(DICT_PATH)
    : DICT_PATH;

  const resp = await fetch(url);
  const json = await resp.json();
  DICT_DATA = json._data || {};

  DICT_BUCKETS = new Map();
  DICT_MAX_WORD_LEN = 0;

  for (const word of Object.keys(DICT_DATA)) {
    const w = word.normalize("NFC");
    DICT_MAX_WORD_LEN = Math.max(DICT_MAX_WORD_LEN, [...w].length);
    const first = w.charAt(0);
    if (!DICT_BUCKETS.has(first)) DICT_BUCKETS.set(first, new Set());
    DICT_BUCKETS.get(first).add(w);
  }

  DICT_LOADED = true;
  console.log("Dictionary loaded:", Object.keys(DICT_DATA).length);
}

/* ============================================================
   TRUE RIKAIKUN MATCHER (DICTIONARY-FIRST)
   ============================================================ */

function findMatchAt(text, cursor) {
  const ctx = text.normalize("NFC");

  for (let start = cursor; start >= 0 && cursor - start < DICT_MAX_WORD_LEN; start--) {
    const first = ctx.charAt(start);
    const bucket = DICT_BUCKETS.get(first);
    if (!bucket) continue;

    for (let len = DICT_MAX_WORD_LEN; len > 0; len--) {
      const end = start + len;
      if (end <= cursor || end > ctx.length) continue;

      const cand = ctx.slice(start, end);
      const entry = DICT_DATA[cand];
      if (entry) {
        return { word: cand, entry, start, end };
      }
    }
  }
  return null;
}

/* ============================================================
   MOUSE MOVE HANDLER
   ============================================================ */

function mouseMove(event) {
  if (!DICT_LOADED) return;

  const data = getCaretText(event);
  if (!data) return hideTooltip();

  const { textNode, text, offset } = data;

  if (!/[\u0E00-\u0E7F]/.test(text)) {
    hideTooltip();
    return;
  }

  const match = findMatchAt(text, offset);
  if (!match) {
    hideTooltip();
    return;
  }

  const matchKey = `${textNode}-${match.start}-${match.end}`;
  if (matchKey === currentMatchKey) return;
  currentMatchKey = matchKey;

  clearHighlight();
  highlightRange(textNode, match.start, match.end);

  const entry = match.entry;
  const defs = entry.definitions || [];
  const paiboon = entry.romanization_paiboon || "";

  tooltip.innerHTML = `
    <div style="font-weight:bold;color:#4CAF50">${escapeHtml(match.word)}</div>
    <div style="opacity:0.9;font-size:13px">${escapeHtml(paiboon)}</div>
    ${defs.map(d => `<div style="margin-top:6px">${escapeHtml(d)}</div>`).join("")}
  `;

  tooltip.style.display = "block";
  tooltip.style.left = `${event.clientX + POPUP_OFFSET_X}px`;
  tooltip.style.top = `${event.clientY + POPUP_OFFSET_Y}px`;
}

/* ============================================================
   UTILITIES
   ============================================================ */

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hideTooltip() {
  tooltip.style.display = "none";
  clearHighlight();
  currentMatchKey = null;
}

/* ============================================================
   INIT
   ============================================================ */

async function init() {
  initTooltip();
  initHighlightOverlay();
  await loadDictionary();
  document.addEventListener("mousemove", mouseMove, true);
  document.addEventListener("mouseleave", hideTooltip);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
