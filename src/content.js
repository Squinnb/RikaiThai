/* global chrome */
// console.log("Khao Jai Thai Dictionary Extension loaded");

/* ===============================
   GLOBALS
   =============================== */

const DICT_PATH = "enhanced_thai_dict.json";
let DICT = null;
let MAX_WORD_LEN = 0;
const THAI_CHAR_RE = /[\u0E00-\u0E7F]/;
let hoverTimer = null;
const HOVER_DELAY_MS = 10; // tweak: 30–80ms range
const TOOLTIP_HIDE_DELAY_MS = 150;
let tooltipHideTimer = null;


let activeMatch = null;

const thaiSegmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("th", { granularity: "word" })
    : null;

const THEMES = {
  solar: {
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
  terminal: {
    background: "#000000",
    border: "#00ba6adf",
    word: "#00ba6adf",
    pos: "#aaaaaa",
    text: "#ffffff",
  },
};

let currentTheme = THEMES["midnight"];


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
tooltip.style.fontFamily =
  "'Noto Serif Thai', 'TH Sarabun New', 'Sarabun', 'Leelawadee UI', 'Tahoma', serif";
tooltip.style.lineHeight = "1.35";
tooltip.style.pointerEvents = "auto";
tooltip.style.userSelect = "text";
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

chrome.storage.sync.get("theme", ({ theme }) => {
  applyTheme(theme || "midnight");
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.theme) applyTheme(changes.theme.newValue);
});

/* ===============================
   HIGHLIGHT
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

function scheduleClearHighlight() {
  if (tooltipHideTimer) return;
  tooltipHideTimer = setTimeout(() => {
    tooltipHideTimer = null;
    clearHighlight()
  }, TOOLTIP_HIDE_DELAY_MS);
}

function clearHighlight() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  highlight.style.display = "none";
  tooltip.style.display = "none";
  activeMatch = null;
}

/* ===============================
   CARET
   =============================== */

function caretInfo(e) {
  let node = null,
    offset = 0;

  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos?.offsetNode?.nodeType === 3) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }

  if (!node && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r?.startContainer?.nodeType === 3) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }

  if (!node) return null;
  if (!THAI_CHAR_RE.test(node.nodeValue)) return null;

  return { node, text: node.nodeValue, offset };
}

/* ===============================
    MEANINGFUL FILTER
   =============================== */

function isMeaningfulEntry(entry, word, segmentLength) {
  if (!entry) return false;

  // Reject single-char matches inside longer words
  if (segmentLength > 1 && word.length === 1) return false;

  // Reject character entries inside longer words
  if (segmentLength > 1 && entry.pos?.includes("character")) return false;

  return true;
}

/* ===============================
   WORD RESOLUTION (CORE)
   =============================== */

function resolveSegment(segment) {
  const tokens = [];

  // full match
  if (DICT[segment]) {
    tokens.push({ word: segment, entry: DICT[segment] });
  }

  // decompose
  let i = 0;
  const parts = [];

  while (i < segment.length) {
    let found = null;

    for (let len = Math.min(MAX_WORD_LEN, segment.length - i); len >= 1; len--) {
      const sub = segment.slice(i, i + len);
      if (DICT[sub]) {
        found = sub;
        parts.push({ word: sub, entry: DICT[sub] });
        i += len;
        break;
      }
    }

    if (!found) i++;
  }

  /* ===============================
      FILTER JUNK DECOMPOSITIONS
     =============================== */

  const hasJunk =
    segment.length > 1 &&
    parts.some((p) => !isMeaningfulEntry(p.entry, p.word, segment.length));

  if (hasJunk) {
    return [
      {
        word: segment,
        entry: {
          pos: ["unknown"],
          romanization_paiboon: "",
          senses: [{ gloss: "(no definition found)" }],
        },
      },
    ];
  }

  if (!(parts.length === 1 && parts[0].word === segment)) {
    tokens.push(...parts);
  }

  if (tokens.length === 0) {
    tokens.push({
      word: segment,
      entry: {
        pos: ["unknown"],
        romanization_paiboon: "",
        senses: [{ gloss: "(no definition found)" }],
      },
    });
  }

  return tokens;
}

/* ===============================
   MATCHER
   =============================== */

   function findWordSmart(text, offset) {
    if (!thaiSegmenter) return null;
  
    const segments = [...thaiSegmenter.segment(text)];
  
    const i = segments.findIndex((s) => {
      const start = s.index;
      const end = start + s.segment.length;
      return offset >= start && offset < end;
    });
  
    if (i === -1) return null;
    
    const seg = segments[i];

    // Ignore non-Thai segments
    if (!THAI_CHAR_RE.test(seg.segment)) {
      return null;
    }
  
    const MAX_COMBINE = 4;
  
    // Try catching commonly mistakenly segmented foreign words written in Thai(e.g. ควอลิฟาย, qualify). Only checks to the right of cursor segment, maybe add left in the future...
    for (let len = MAX_COMBINE; len >= 1; len--) {
      const slice = segments.slice(i, i + len);
      const combined = slice.map((s) => s.segment).join("");
  
      if (DICT[combined]) {
        return {
          tokens: resolveSegment(combined),
          start: slice[0].index,
          end:
            slice[slice.length - 1].index +
            slice[slice.length - 1].segment.length,
        };
      }
    }
  
  
    return {
      tokens: resolveSegment(seg.segment),
      start: seg.index,
      end: seg.index + seg.segment.length,
    };
  }

/* ===============================
   TOOLTIP RENDER
   =============================== */

function renderTooltip(tokens) {
  let html = "";

  tokens.forEach((item, idx) => {
    const { word, entry } = item;

    const posText = entry.pos?.join(", ") || "";
    const roman = entry.romanization_paiboon || "";
    const senses = entry.senses || [];

    if (idx > 0) {
      html += `<div style="margin-top:6px;border-top:1px solid ${currentTheme.border};opacity:0.3;"></div>`;
    }

    html += `
      <div style="font-size:24px;font-weight:bold;color:${currentTheme.word};margin-top:4px;">
        ${word}
      </div>
      <div style="font-size:14px;opacity:0.85;">
        ${roman}
      </div>
      <div style="font-size:12px;color:${currentTheme.pos};margin-bottom:4px;">
        ${posText}
      </div>
    `;

    senses.forEach((sense, i) => {
      if (!sense?.gloss) return;

      html += `
        <div style="font-size:14px;line-height:1.35;">
          <span style="font-size:11px;opacity:0.7;margin-right:4px;">${i + 1}.</span>
          ${sense.gloss}
        </div>
      `;
    });
  });

  tooltip.innerHTML = html;
}

/* ===============================
   MOUSE
   =============================== */

function hasDirectThaiText(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && THAI_CHAR_RE.test(node.nodeValue)) {
      return true;
    }
  }
  return false;
}

let isEnabled = true;

chrome.storage.sync.get("enabled", ({ enabled }) => {
  isEnabled = enabled !== false;
});

function cancelClearHighlight() {
  if (!tooltipHideTimer) return;
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = null;
}

function onMove(e) {
  if (!DICT || !isEnabled) return;
  cancelClearHighlight()

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !hasDirectThaiText(el)) {
    clearHighlight()
    return;
  }

  const info = caretInfo(e);
  if (!info) {
    clearHighlight()
    return;
  }

  if (
    activeMatch &&
    info.node === activeMatch.node &&
    info.offset >= activeMatch.start &&
    info.offset < activeMatch.end
  ) {
    return;
  }

  const match = findWordSmart(info.text, info.offset);
  if (!match) {
    scheduleClearHighlight();
    return;
  }

  // activeMatch = {
  //   node: info.node,
  //   start: match.start,
  //   end: match.end,
  // };
  // const rect = drawHighlight(info.node, match.start, match.end);
  // renderTooltip(match.tokens);
  // tooltip.style.display = "block";
  if (hoverTimer) clearTimeout(hoverTimer);

hoverTimer = setTimeout(() => {
  activeMatch = {
    node: info.node,
    start: match.start,
    end: match.end,
  };

  const rect = drawHighlight(info.node, match.start, match.end);
  if (!rect) return;

  renderTooltip(match.tokens);
  tooltip.style.display = "block";
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const tooltipRect = tooltip.getBoundingClientRect();

  let left = rect.left + gap;
  let top = rect.bottom + gap;

  if (left + tooltipRect.width > vw) {
    left = rect.left - tooltipRect.width - gap;
  }

  if (top + tooltipRect.height > vh) {
    top = rect.top - tooltipRect.height - gap;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  }, HOVER_DELAY_MS);
}

/* ===============================
   LOAD
   =============================== */

async function loadDict() {
  const res = await fetch(chrome.runtime.getURL(DICT_PATH));
  const json = await res.json();
  DICT = json._data;

  MAX_WORD_LEN = Math.max(...Object.keys(DICT).map((w) => [...w].length));
}

/* ===============================
   INIT
   =============================== */

(async function () {
  await loadDict();
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("scroll", clearHighlight, true);
})();