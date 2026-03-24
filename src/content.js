console.log("Thai Dictionary Extension loaded (FINAL RIKAIKUN STYLE)");

/* ===============================
   GLOBALS
   =============================== */

const DICT_PATH = "thai_dict2.json";
let DICT = null;
let MAX_WORD_LEN = 0;

let activeMatch = null; // { start, end, word }

/* ===============================
   TOOLTIP
   =============================== */

const tooltip = document.createElement("div");
tooltip.style.position = "fixed";
tooltip.style.zIndex = "2147483647";
tooltip.style.background = "rgba(0,0,0,0.95)";
tooltip.style.color = "#fff";
tooltip.style.border = "2px solid #4CAF50";
tooltip.style.borderRadius = "6px";
tooltip.style.padding = "8px";
tooltip.style.fontSize = "16px";
tooltip.style.display = "none";
tooltip.style.maxWidth = "360px";
document.body.appendChild(tooltip);

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
  

/* ===============================
   TOOLTIP UI (POS GROUPED)
   =============================== */

function renderTooltip(word, entry) {

  console.log("entry: ", entry);
  console.log("word: ", word);
  let html = `
    <div style="font-size:28px;font-weight:bold;color:#4CAF50;">
      ${word}
    </div>
    <div style="opacity:0.85;margin-bottom:6px;">
      ${entry.romanization_paiboon || ""}
    </div>
  `;

  html += `
    <div style="margin-top:6px; font-size:12px; color:#aaa;">
      ${entry.pos.join(", ")}
    </div>
  `;
  entry.senses.map((sense) => {
    html += `
    <div style="margin-top:3px;">
      ${sense}
    </div>
    `
  })
  

  tooltip.innerHTML = html;
}

/* ===============================
   MOUSE HANDLER
   =============================== */

function onMove(e) {
  if (!DICT) return;

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
})();
