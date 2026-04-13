/* global chrome */
console.log("Thai Dictionary Extension loaded (FINAL RIKAIKUN STYLE)");

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
let unknownWordBuffer = {};
let unknownWordFlushTimer = null;
let lastMissSignature = "";

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
tooltip.style.position = "fixed";
tooltip.style.zIndex = "2147483647";
tooltip.style.borderRadius = "6px";
tooltip.style.padding = "8px";
tooltip.style.fontSize = "16px";
tooltip.style.fontFamily = "'Noto Serif Thai', 'TH Sarabun New', 'Sarabun', 'Leelawadee UI', 'Tahoma', serif";
tooltip.style.fontFeatureSettings = "'liga' 1, 'kern' 1";
tooltip.style.display = "none";
tooltip.style.maxWidth = "360px";
document.body.appendChild(tooltip);

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
  console.log("storage changed", changes);
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
  if (!rect) return;

  highlight.style.left = `${rect.left}px`;
  highlight.style.top = `${rect.top}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  highlight.style.display = "block";
}

function clearHighlight() {
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
   RIKAIKUN MATCHER (FIXED)
   =============================== */

function findWord(text, cursor) {
  for (let len = MAX_WORD_LEN; len >= 2; len--) {
    const end = cursor + len;
    if (end > text.length) continue;
    
    const word = text.slice(cursor, end);
    const entry = DICT[word];
    if (entry) return { word, entry, start: cursor, end };
  }
  return null;
}

function extractUnknownCandidate(text, cursor) {
  if (!text || cursor < 0 || cursor >= text.length) return null;
  if (!THAI_CHAR_RE.test(text[cursor])) return null;

  let start = cursor;
  let end = cursor + 1;
  while (start > 0 && THAI_CHAR_RE.test(text[start - 1])) start--;
  while (end < text.length && THAI_CHAR_RE.test(text[end])) end++;

  const run = text.slice(start, end);
  if (run.length < 2) return null;

  const localCursor = cursor - start;
  const windowStart = Math.max(0, localCursor - 6);
  const windowEnd = Math.min(run.length, localCursor + 6);
  return run.length <= 12 ? run : run.slice(windowStart, windowEnd);
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
  const candidate = extractUnknownCandidate(text, cursor);
  if (!candidate) return;

  const signature = `${candidate}|${cursor}`;
  if (signature === lastMissSignature) return;
  lastMissSignature = signature;

  unknownWordBuffer[candidate] = (unknownWordBuffer[candidate] || 0) + 1;
  scheduleUnknownWordFlush();
}

function dumpUnknownWordMisses(limit = 100) {
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
    <div style="font-family:inherit;font-size:28px;font-weight:bold;color:${currentTheme.word};">
      ${word}
    </div>
    <div style="font-family:inherit;opacity:0.85;margin-bottom:6px;">
      ${roman}
    </div>
    <div style="font-family:inherit;margin-top:6px;font-size:12px;color:${currentTheme.pos};">
      ${posText}
    </div>
  `;

  senses.forEach((sense, idx) => {
    if (!sense || !sense.gloss) return;
    const registerText = sense.register && sense.register.length
      ? ` <span style="opacity:0.8;color:${currentTheme.pos};">(${sense.register.join(", ")})</span>`
      : "";
    html += `<div style="font-family:inherit;margin-top:4px;font-size:14px;line-height:1.35;">
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

  // Quick bail: no Thai text in the element under cursor
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !hasDirectThaiText(el)) {
    clearHighlight();
    return;
  }

  const info = caretInfo(e);
  if (!info || !/[\u0E00-\u0E7F]/.test(info.text)) {
    clearHighlight();
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
    clearHighlight();
    return;
  }

  activeMatch = {
    node: info.node,
    start: match.start,
    end: match.end
  };

  drawHighlight(info.node, match.start, match.end);
  renderTooltip(match.word, match.entry);

  tooltip.style.left = `${e.clientX + 18}px`;
  tooltip.style.top = `${e.clientY + 20}px`;
  tooltip.style.display = "block";
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
  window.__thaiDictTools = {
    dumpUnknownWordMisses,
    clearUnknownWordMisses
  };
})();
