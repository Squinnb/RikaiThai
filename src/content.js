// content.js — integrated version with dictionary loader + fast lookup
console.log("Thai Dictionary Extension loaded (integrated)");

/* -------------------------
   Config / Globals
   ------------------------- */
const TOOLTIP_ID = "thai-dict-tooltip";
const DICT_PATH = "thai_dict.json"; // packaged in extension root
let DICT = null;
let DICT_DATA = null;
let DICT_MAX_WORD_LEN = 0;
let DICT_BUCKETS = null; // Map(firstChar -> Set(words))
let DICT_LOADED = false;

/* -------------------------
   Old inline dictionary removed — we use the loaded file now
   ------------------------- */

// Tooltip / UI things (kept from your original)
const tooltip = document.createElement('div');
let segmenter = null;
let currentWord = null;

// --- Popup hover logic ---
let popupHovered = false;
let wordHovered = false;
let hidePopupTimeout = null;
const POPUP_OFFSET_X = 18;
const POPUP_OFFSET_Y = 20;

/* ============================================================
   SAFE HIGHLIGHT SYSTEM (kept and slightly cleaned)
   ============================================================ */

let activeHighlight = null;

function highlightWord(textNode, word, start, end) {
  removeHighlight(); // remove old highlight first

  if (!textNode || textNode.nodeType !== 3) return;
  const text = textNode.nodeValue;
  if (!text) return;

  // word coordinates are absolute within the text node (start/end)
  if (text.slice(start, end) !== word) {
    // If mismatched, try slicing by codepoints just in case
    if ([...text].slice(start, end).join('') !== word) return;
  }

  const parent = textNode.parentNode;
  if (!parent) return;

  const before = document.createTextNode(text.slice(0, start));
  const after = document.createTextNode(text.slice(end));

  const span = document.createElement("span");
  span.textContent = word;
  span.className = "thai-highlight-word";
  span.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
  span.style.outline = "2px solid #FFD700";
  span.style.outlineOffset = "1px";
  span.style.borderRadius = "4px";

  span.addEventListener("mouseenter", () => {
    wordHovered = true;
    if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  });

  span.addEventListener("mouseleave", () => {
    wordHovered = false;
    delayedHideTooltip();
  });

  // insert before/word/after and remove original node
  parent.insertBefore(before, textNode);
  parent.insertBefore(span, textNode);
  parent.insertBefore(after, textNode);
  parent.removeChild(textNode);

  activeHighlight = {
    parent,
    before,
    span,
    after,
    originalNode: textNode,
    originalText: text
  };
}

function removeHighlight() {
  if (!activeHighlight) return;

  const { parent, before, span, after, originalNode, originalText } = activeHighlight;

  // remove nodes we added if they still exist
  try {
    if (before && before.parentNode === parent) parent.removeChild(before);
    if (span && span.parentNode === parent) parent.removeChild(span);
    if (after && after.parentNode === parent) parent.removeChild(after);

    // attempt to restore original node in place — safe guarded
    originalNode.nodeValue = originalText;
    // Insert at end if parent changed; exact position may be lost if DOM mutated by framework
    parent.appendChild(originalNode);
  } catch (e) {
    // If React or dynamic DOM replaced container, just skip restoring
    console.warn("DOM changed before restore; skipping safe restore", e);
  }

  activeHighlight = null;
}

/* ============================================================
   Segmenter / segmentation helpers (unchanged logic)
   ============================================================ */

const initSegmenter = () => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      segmenter = new Intl.Segmenter('th', { granularity: 'word' });
      console.log("Intl.Segmenter initialized for Thai");
      return true;
    } else {
      console.warn("Intl.Segmenter not supported in this browser");
      return false;
    }
  } catch (error) {
    console.error("Failed to init Segmenter:", error);
    return false;
  }
};

const fallbackSegment = (text) => {
  // Simple fallback — splits on whitespace. Not ideal for Thai, but only a fallback.
  return text.split(/[\s\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/).filter(word => word.length > 0);
};

const segmentText = (text) => {
  if (segmenter) {
    const segments = segmenter.segment(text);
    return Array.from(segments)
      .filter(seg => seg.isWordLike)
      .map(seg => seg.segment);
  } else {
    return fallbackSegment(text);
  }
};

/* ============================================================
   Tooltip visual init (kept your styling but class/id added)
   ============================================================ */

const initToolTip = () => {
  tooltip.id = TOOLTIP_ID;
  tooltip.style.position = 'fixed';
  tooltip.style.background = 'rgba(0, 0, 0, 0.95)';
  tooltip.style.color = 'white';
  tooltip.style.border = '2px solid #4CAF50';
  tooltip.style.borderRadius = '6px';
  tooltip.style.padding = '8px 12px';
  tooltip.style.fontSize = '18px';
  // Keep fontFamily you had (you fixed the actual font earlier)
  tooltip.style.fontFamily = "thongterm, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial";
  tooltip.style.zIndex = '2147483647';
  tooltip.style.display = 'none';
  tooltip.style.pointerEvents = 'auto';
  tooltip.style.lineHeight = '1.4';
  tooltip.style.maxWidth = '360px';
  tooltip.style.wordBreak = 'break-word';

  tooltip.addEventListener('mouseenter', () => {
    popupHovered = true;
    if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  });

  tooltip.addEventListener('mouseleave', () => {
    popupHovered = false;
    delayedHideTooltip();
  });

  document.body.appendChild(tooltip);
};

function delayedHideTooltip() {
  if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  hidePopupTimeout = setTimeout(() => {
    if (!popupHovered && !wordHovered) {
      hideTooltip();
    }
  }, 120);
}

/* ============================================================
   Text caret and context helpers (kept original logic)
   ============================================================ */

const getTextAroundCursor = (event) => {
  try {
    let pos = null;
    if (document.caretPositionFromPoint) {
      pos = document.caretPositionFromPoint(event.clientX, event.clientY);
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (range) pos = { offsetNode: range.startContainer, offset: range.startOffset };
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
    const contextStart = Math.max(0, offset - 50);
    const contextEnd = Math.min(text.length, offset + 50);
    const context = text.slice(contextStart, contextEnd);

    return {
      context,
      relativeOffset: offset - contextStart,
      textNode,
      absoluteOffset: offset
    };

  } catch (err) {
    // swallow — safe fallback
    return null;
  }
};

const findWordAtPosition = (segments, context, offset) => {
  let pos = 0;
  for (const w of segments) {
    const start = context.indexOf(w, pos);
    if (start === -1) continue;
    const end = start + w.length;
    if (offset >= start && offset <= end) return { word: w, start, end };
    pos = end;
  }
  return null;
};

/* ============================================================
   DICTIONARY LOADING + PRECOMPUTE (your 1 + 2)
   - load thai_dict.json via chrome.runtime.getURL + fetch
   - build DICT_BUCKETS and DICT_MAX_WORD_LEN
   ============================================================ */

async function loadDictionary() {
  if (DICT_LOADED) return;
  try {
    const url = chrome && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(DICT_PATH) : DICT_PATH;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Failed to fetch dictionary: " + resp.status);
    DICT = await resp.json();
    DICT_DATA = DICT._data || {};
    DICT_MAX_WORD_LEN = 0;
    DICT_BUCKETS = new Map();

    for (const w of Object.keys(DICT_DATA)) {
      const word = w.normalize('NFC');
      const len = [...word].length;
      if (len > DICT_MAX_WORD_LEN) DICT_MAX_WORD_LEN = len;

      const first = word.charAt(0); // first code unit (usually OK for Thai)
      let set = DICT_BUCKETS.get(first);
      if (!set) {
        set = new Set();
        DICT_BUCKETS.set(first, set);
      }
      set.add(word);
    }

    DICT_LOADED = true;
    console.log("Thai dictionary loaded. entries:", Object.keys(DICT_DATA).length, "maxWordLen:", DICT_MAX_WORD_LEN);
  } catch (e) {
    console.error("Error loading Thai dictionary:", e);
    DICT = null;
    DICT_DATA = null;
    DICT_BUCKETS = null;
    DICT_LOADED = false;
  }
}

/* ============================================================
   LOOKUP HELPERS (your 3 + 4)
   - prefer exact segment lookup; fallback to longestLeftAnchoredMatch
   ============================================================ */

function lookupExact(word) {
  if (!DICT_DATA) return null;
  return DICT_DATA[word] || DICT_DATA[word.normalize('NFC')] || null;
}

// Longest left-anchored match, scanning starts left of offset
function longestLeftAnchoredMatch(context, cursorOffset) {
  if (!DICT_DATA || !DICT_BUCKETS) return null;
  const ctx = context.normalize('NFC');
  const totalLen = [...ctx].length;

  // Convert cursorOffset (index in chars) to codepoint-aware offset:
  // but since we used slicing earlier with JS string indices, use those indices (works unless combining marks)
  // We'll implement using JS string slicing (consistent with the rest of the code).
  // We'll attempt start positions from cursorOffset down to cursorOffset - (DICT_MAX_WORD_LEN - 1)
  const maxLeft = Math.min(DICT_MAX_WORD_LEN - 1, cursorOffset);
  for (let left = maxLeft; left >= 0; left--) {
    const start = cursorOffset - left;
    // right length bound from start
    const maxRight = Math.min(DICT_MAX_WORD_LEN, ctx.length - start);
    for (let L = maxRight; L >= 1; L--) {
      const candidate = ctx.slice(start, start + L);
      if (!candidate) continue;
      const first = candidate.charAt(0);
      const bucket = DICT_BUCKETS.get(first);
      if (!bucket) continue;
      const entry = DICT_DATA[candidate];
      if (entry) return { word: candidate, entry, start, end: start + L };
    }
  }

  return null;
}

/* ============================================================
   mouseMove handler (uses segmenter result first)
   ============================================================ */

const mouseMove = (event) => {
  // Only proceed if dictionary loaded — minimal guard
  if (!DICT_LOADED) {
    // still show nothing; don't block
    return;
  }

  const data = getTextAroundCursor(event);
  if (!data) return hideTooltip();

  const { context, relativeOffset, textNode, absoluteOffset } = data;

  // quick check: no Thai in context
  if (!/[\u0E00-\u0E7F]/.test(context)) {
    hideTooltip();
    return;
  }

  const segments = segmentText(context);
  const segResult = findWordAtPosition(segments, context, relativeOffset);

  // Try exact segment lookup first (O(1))
  let matched = null;
  if (segResult && segResult.word) {
    const candidate = segResult.word.trim();
    const entry = lookupExact(candidate);
    if (entry) {
      matched = { word: candidate, entry, start: segResult.start, end: segResult.end };
    }
  }

  // If no exact match via segmenter (or segmenter gave a multi-word chunk), fallback to longestLeftAnchoredMatch
  if (!matched) {
    matched = longestLeftAnchoredMatch(context, relativeOffset);
  }

  if (!matched) {
    hideTooltip();
    return;
  }

  const hoveredWord = matched.word;
  const entry = matched.entry;

  if (currentWord === hoveredWord) return;

  currentWord = hoveredWord;
  removeHighlight();

  // compute absolute positions relative to text node
  const ctxStart = Math.max(0, absoluteOffset - 50);
  const absStart = ctxStart + matched.start;
  const absEnd = ctxStart + matched.end;

  highlightWord(textNode, hoveredWord, absStart, absEnd);

  // Build tooltip content using fields from your dictionary entry
  const paiboon = entry.romanization_paiboon || "";
  const royal = entry.romanization_royal || "";
  const defs = (entry.definitions && entry.definitions.length) ? entry.definitions : [];
  const defHtml = defs.map(d => `<div style="margin-top:6px;">${escapeHtml(d)}</div>`).join("");

  tooltip.innerHTML = `
    <div style="font-weight:bold;color:#4CAF50;font-size:18px;">${escapeHtml(hoveredWord)}</div>
    <div style="margin-top:6px;color:#ffffff;font-size:13px;">
      <div style="opacity:0.95">${escapeHtml(paiboon)}</div>
      <div style="opacity:0.85;font-size:12px;">${escapeHtml(royal)}</div>
    </div>
    ${defHtml}
  `;

  // Copy computed font from the hovered element to tooltip so visual matches
  try {
    const hostEl = (textNode && textNode.parentElement) ? textNode.parentElement : document.elementFromPoint(event.clientX, event.clientY);
    if (hostEl) {
      const cs = window.getComputedStyle(hostEl);
      if (cs && cs.font) {
        tooltip.style.font = cs.font;
      } else {
        tooltip.style.fontFamily = cs.fontFamily || tooltip.style.fontFamily;
        tooltip.style.fontSize = cs.fontSize || tooltip.style.fontSize;
        tooltip.style.lineHeight = cs.lineHeight || tooltip.style.lineHeight;
        tooltip.style.fontWeight = cs.fontWeight || tooltip.style.fontWeight;
      }
    }
  } catch (err) {
    // ignore font copy errors
  }

  tooltip.style.display = 'block';
  tooltip.style.left = `${event.clientX + POPUP_OFFSET_X}px`;
  tooltip.style.top = `${event.clientY + POPUP_OFFSET_Y}px`;
};

/* ============================================================
   Utility: escapeHtml to prevent broken HTML in tooltip
   ============================================================ */
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============================================================
   hideTooltip and init
   ============================================================ */
const hideTooltip = () => {
  tooltip.style.display = 'none';
  removeHighlight();
  currentWord = null;
};

const init = async () => {
  initSegmenter();
  initToolTip();
  await loadDictionary(); // ensure DICT loaded before adding handlers
  document.addEventListener('mousemove', mouseMove, true);
  document.addEventListener('mouseleave', hideTooltip);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
