/* global chrome */
console.log("Thai Dictionary Extension loaded");

/* ===============================
   GLOBALS
   =============================== */

const DICT_PATH = "enhanced_thai_dict.json";
let DICT = null;
let MAX_WORD_LEN = 0;
const THAI_CHAR_RE = /[\u0E00-\u0E7F]/;

const UNKNOWN_WORD_LOG_KEY = "unknownWordMisses";
const UNKNOWN_WORD_MAX_ITEMS = 1000;
const UNKNOWN_WORD_FLUSH_MS = 2500;
const ENABLE_UNKNOWN_WORD_LOGGER = false; // Set true for local dictionary curation.
let unknownWordBuffer = {};
let unknownWordFlushTimer = null;
let lastMissSignature = "";
const thaiSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("th", { granularity: "word" })
  : null;
const TOOLTIP_HIDE_DELAY_MS = 320;
let tooltipHideTimer = null;
let isHoveringTooltip = false;

let activeMatch = null; // { start, end, word }

const THEMES = {
  "Thai Flag": {
    background: "#fdf6e3",
    border: "#cb4b16",
    word: "#268bd2",
    pos: "#93a1a1",
    text: "#657b83",
  },
  midnight: {
    background: "#1a1b2e",
    border: "#7c6af7",
    word: "#7c6af7",
    pos: "#7a7a9a",
    text: "#c8c8e8",
  },
  "high-contrast": {
    background: "#000000",
    border: "#ffff00",
    word: "#ffff00",
    pos: "#aaaaaa",
    text: "#ffffff",
  },
};

let currentTheme = THEMES["midnight"]; // default

/* ===============================
   TOOLTIP
   =============================== */

const tooltip = document.createElement("div");
tooltip.style.all = "initial";
tooltip.style.boxSizing = "border-box";
tooltip.style.position = "fixed";
tooltip.style.zIndex = "2147483647";
tooltip.style.borderRadius = "6px";
tooltip.style.padding = "8px";
tooltip.style.fontSize = "16px";
tooltip.style.fontFamily = "'Noto Serif Thai', 'TH Sarabun New', 'Sarabun', 'Leelawadee UI', 'Tahoma', serif";
tooltip.style.fontFeatureSettings = "'liga' 1, 'kern' 1";
tooltip.style.lineHeight = "1.35";
tooltip.style.letterSpacing = "normal";
tooltip.style.wordSpacing = "normal";
tooltip.style.whiteSpace = "normal";
tooltip.style.pointerEvents = "auto";
tooltip.style.userSelect = "text";
tooltip.style.display = "none";
tooltip.style.maxWidth = "360px";
document.body.appendChild(tooltip);

tooltip.addEventListener("mouseenter", () => {
  isHoveringTooltip = true;
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
});

tooltip.addEventListener("mouseleave", () => {
  isHoveringTooltip = false;
  scheduleClearHighlight();
});

function applyTheme(t) {
  const theme = THEMES[t] || THEMES["midnight"];
  currentTheme = theme;
  tooltip.style.background = theme.background;
  tooltip.style.border = `2px solid ${theme.border}`;
  tooltip.style.color = theme.text;
}

// Load saved theme
chrome.storage.sync.get("theme", ({ theme }) => {
  applyTheme(theme || "midnight");
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.theme) {
    applyTheme(changes.theme.newValue);
  }
});


/* ===============================
   OVERLAY HIGHLIGHT
   =============================== */

const highlight = document.createElement("div");
highlight.style.position = "fixed";
highlight.style.background = "rgba(98,172,237,0.45)";
highlight.style.outline = "1px solid rgba(0,31,49,0.6)";
highlight.style.borderRadius = "4px";
highlight.style.pointerEvents = "none";
highlight.style.zIndex = "2147483646";
highlight.style.display = "none";
document.body.appendChild(highlight);

function drawHighlight(node, start, end) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);

  const rect = range.getClientRects()[0];
  if (!rect) return null;

  highlight.style.left = `${rect.left}px`;
  highlight.style.top = `${rect.top}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  highlight.style.display = "block";
  return rect;
}

function pointInRect(x, y, rect) {
  return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function scheduleClearHighlight() {
  if (tooltipHideTimer) return;
  tooltipHideTimer = setTimeout(() => {
    tooltipHideTimer = null;
    if (!isHoveringTooltip) clearHighlight();
  }, TOOLTIP_HIDE_DELAY_MS);
}

function cancelClearHighlight() {
  if (!tooltipHideTimer) return;
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = null;
}

function clearHighlight() {
  cancelClearHighlight();
  highlight.style.display = "none";
  tooltip.style.display = "none";
  activeMatch = null;
}

/* ===============================
   CARET DETECTION
   =============================== */

function caretInfo(e) {
  let node = null, offset = 0;

  // Primary method
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos && pos.offsetNode.nodeType === 3) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }

  // Fallback: caretRangeFromPoint (Chrome's native method)
  if (!node && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r && r.startContainer.nodeType === 3) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }

  // Last resort: walk into the element under cursor and find a Thai text node
  if (!node) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (/[\u0E00-\u0E7F]/.test(textNode.nodeValue)) {
          node = textNode;
          offset = 0; // imprecise but better than nothing
          break;
        }
      }
    }
  }

  if (!node || !/[\u0E00-\u0E7F]/.test(node.nodeValue)) return null;

  return { node, text: node.nodeValue, offset };
}

/* ===============================
   MATCHER (FIXED)
   =============================== */

function findWord(text, cursor) {
  console.log("findWord(text): ", text); // doesn't appear to break up text via sentences Thai style(spaces!!) so text is just a giant paragraph.
  for (let len = MAX_WORD_LEN; len >= 2; len--) {
    const end = cursor + len;
    if (end > text.length) continue;
    
    const word = text.slice(cursor, end);
    const entry = DICT[word];
    if (entry) console.log("entry: ", entry); // check match
    if (entry) return { word, entry, start: cursor, end };
  }
  return null;
}

function extractUnknownCandidate(text, cursor) {
  if (!text || cursor < 0 || cursor >= text.length) return null;
  if (!THAI_CHAR_RE.test(text[cursor])) return null;

  if (thaiSegmenter) {
    for (const part of thaiSegmenter.segment(text)) {
      const index = part.index;
      const segment = part.segment || "";
      const end = index + segment.length;
      if (cursor < index || cursor >= end) continue;
      if (!part.isWordLike) return null;
      if (!THAI_CHAR_RE.test(segment)) return null;
      if (segment.length < 2 || segment.length > 40) return null;
      return segment;
    }
  }

  let start = cursor;
  let end = cursor + 1;
  while (start > 0 && THAI_CHAR_RE.test(text[start - 1])) start--;
  while (end < text.length && THAI_CHAR_RE.test(text[end])) end++;

  const run = text.slice(start, end);
  if (run.length < 2 || run.length > 40) return null;
  return run;
}

function scheduleUnknownWordFlush() {
  if (unknownWordFlushTimer) return;
  unknownWordFlushTimer = setTimeout(() => {
    const pending = unknownWordBuffer;
    unknownWordBuffer = {};
    unknownWordFlushTimer = null;

    chrome.storage.local.get(UNKNOWN_WORD_LOG_KEY, (res) => {
      const existing = res[UNKNOWN_WORD_LOG_KEY] || {};
      for (const [word, count] of Object.entries(pending)) {
        existing[word] = (existing[word] || 0) + count;
      }

      const trimmed = Object.fromEntries(
        Object.entries(existing)
          .sort((a, b) => b[1] - a[1])
          .slice(0, UNKNOWN_WORD_MAX_ITEMS)
      );
      chrome.storage.local.set({ [UNKNOWN_WORD_LOG_KEY]: trimmed });
    });
  }, UNKNOWN_WORD_FLUSH_MS);
}

function logUnknownWordMiss(text, cursor) {
  if (!ENABLE_UNKNOWN_WORD_LOGGER) return;
  const candidate = extractUnknownCandidate(text, cursor);
  if (!candidate) return;

  const signature = `${candidate}|${cursor}`;
  if (signature === lastMissSignature) return;
  lastMissSignature = signature;

  unknownWordBuffer[candidate] = (unknownWordBuffer[candidate] || 0) + 1;
  scheduleUnknownWordFlush();
}

function dumpUnknownWordMisses(limit = 100) {
  if (!ENABLE_UNKNOWN_WORD_LOGGER) return;
  chrome.storage.local.get(UNKNOWN_WORD_LOG_KEY, (res) => {
    const misses = res[UNKNOWN_WORD_LOG_KEY] || {};
    const rows = Object.entries(misses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word, count]) => ({ word, count }));
    console.table(rows);
  });
}

function clearUnknownWordMisses() {
  if (!ENABLE_UNKNOWN_WORD_LOGGER) return;
  chrome.storage.local.remove(UNKNOWN_WORD_LOG_KEY);
  unknownWordBuffer = {};
  lastMissSignature = "";
  if (unknownWordFlushTimer) {
    clearTimeout(unknownWordFlushTimer);
    unknownWordFlushTimer = null;
  }
}
  

/* ===============================
   TOOLTIP UI
   =============================== */

function renderTooltip(word, entry) {
  const posText = entry.pos.join(", ");
  const roman = entry.romanization_paiboon || "";
  const senses = entry.senses;

  let html = `
    <div style="font-family:inherit;display:block;margin:0;padding:0;font-size:28px;line-height:1.2;font-weight:bold;color:${currentTheme.word};">
      ${word}
    </div>
    <div style="font-family:inherit;display:block;margin:2px 0 6px 0;padding:0;font-size:15px;line-height:1.25;opacity:0.85;">
      ${roman}
    </div>
    <div style="font-family:inherit;display:block;margin:0 0 4px 0;padding:0;font-size:12px;line-height:1.25;color:${currentTheme.pos};">
      ${posText}
    </div>
  `;

  senses.forEach((sense, idx) => {
    if (!sense || !sense.gloss) return;
    const registerText = sense.register && sense.register.length
      ? ` <span style="font-family:inherit;opacity:0.8;color:${currentTheme.pos};">(${sense.register.join(", ")})</span>`
      : "";
    html += `<div style="font-family:inherit;display:block;margin:4px 0 0 0;padding:0;font-size:14px;line-height:1.35;">
      <span style="font-size:11px;opacity:0.75;color:${currentTheme.pos};margin-right:4px;">${idx + 1}.</span>
      ${sense.gloss}${registerText}
    </div>`;
  });

  tooltip.innerHTML = html;
}

/* ===============================
   MOUSE HANDLER
   =============================== */

function hasDirectThaiText(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && /[\u0E00-\u0E7F]/.test(node.nodeValue)) {
      return true;
    }
  }
  return false;
}

let isEnabled = true;

chrome.storage.sync.get("enabled", ({ enabled }) => {
  isEnabled = enabled !== false;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.theme) applyTheme(changes.theme.newValue);
  if (changes.enabled) {
    isEnabled = changes.enabled.newValue;
    if (!isEnabled) clearHighlight();
  }
});

function onMove(e) {
  if (!DICT || !isEnabled) return;
  cancelClearHighlight();

  if (tooltip.style.display === "block") {
    const tooltipRect = tooltip.getBoundingClientRect();
    if (pointInRect(e.clientX, e.clientY, tooltipRect)) return;
  }

  // Quick bail: no Thai text in the element under cursor
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !hasDirectThaiText(el)) {
    if (isHoveringTooltip) return;
    scheduleClearHighlight();
    return;
  }

  const info = caretInfo(e);
  if (!info || !/[\u0E00-\u0E7F]/.test(info.text)) {
    if (isHoveringTooltip) return;
    scheduleClearHighlight();
    return;
  }

  // If cursor still inside active word, do nothing
  if (
    activeMatch &&
    info.node === activeMatch.node &&
    info.offset >= activeMatch.start &&
    info.offset < activeMatch.end
  ) {
    return;
  }

  const match = findWord(info.text, info.offset);
  if (!match) {
    logUnknownWordMiss(info.text, info.offset);
    if (isHoveringTooltip) return;
    scheduleClearHighlight();
    return;
  }

  activeMatch = {
    node: info.node,
    start: match.start,
    end: match.end
  };

  const wordRect = drawHighlight(info.node, match.start, match.end);
  renderTooltip(match.word, match.entry);
  const gap = 6;
  const viewportPadding = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Measure first, then place to avoid clipping off-screen.
  tooltip.style.visibility = "hidden";
  tooltip.style.display = "block";

  const tooltipRect = tooltip.getBoundingClientRect();
  const anchorX = wordRect ? wordRect.left + (wordRect.width / 2) : e.clientX;
  const anchorYTop = wordRect ? wordRect.top : e.clientY;
  const anchorYBottom = wordRect ? wordRect.bottom : e.clientY;

  let left = anchorX + gap;
  let top = anchorYBottom + gap;

  // Flip horizontally if overflowing right edge.
  if (left + tooltipRect.width + viewportPadding > vw) {
    left = anchorX - tooltipRect.width - gap;
  }
  // Flip vertically if overflowing bottom edge.
  if (top + tooltipRect.height + viewportPadding > vh) {
    top = anchorYTop - tooltipRect.height - gap;
  }

  // Clamp into viewport as final safety.
  left = Math.max(viewportPadding, Math.min(left, vw - tooltipRect.width - viewportPadding));
  top = Math.max(viewportPadding, Math.min(top, vh - tooltipRect.height - viewportPadding));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.visibility = "visible";
}

/* ===============================
   LOAD DICT
   =============================== */

async function loadDict() {
  const res = await fetch(chrome.runtime.getURL(DICT_PATH));
  const json = await res.json();
  DICT = json._data;

  MAX_WORD_LEN = Math.max(...Object.keys(DICT).map(w => [...w].length));
  console.log("Thai dict loaded:", Object.keys(DICT).length);
}

/* ===============================
   INIT
   =============================== */

(async function () {
  await loadDict();
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("scroll", clearHighlight, true);
  if (ENABLE_UNKNOWN_WORD_LOGGER) {
    window.__thaiDictTools = {
      dumpUnknownWordMisses,
      clearUnknownWordMisses
    };
  }
})();
