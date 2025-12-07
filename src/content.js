console.log("Thai Dictionary Extension loaded");

const thaiDict = {
  'ไป': 'go',
  'ไหน': 'where',
  'ไหนดี': 'where to',
  'ไปไหน': 'where go',
  'ดี': 'good',
  'กิน': 'eat',
  'ข้าว': 'rice',
  'มา': 'come',
  'แล้ว': 'already',
  'จาก': 'from',
  'ที่': 'at/that',
  'นี่': 'this',
  'นั่น': 'that',
  'คน': 'person',
  'อะไร': 'what',
  'ทำ': 'do/make',
  'เมื่อไหร่': 'when',
  'ยังไง': 'how',
  'ทำไม': 'why',
  'ห่วง': 'worry/concern',
  'กัมพูชา': 'Cambodia',
  'ประชิด': 'close to/adjacent',
  'ชายแดน': 'border',
  'ผู้บรรยาย': 'narrator',
  'โลก': 'world',
  'ช็อค': 'shock',
  'เลิศศิลา': 'Lerdsila (Thai fighter’s name)',
  'เจอ': 'meet/encounter',
  'มวย': 'boxing/fight',
  'อเมริกา': 'America',
  'จึง': 'therefore/so',
  'ใช้': 'use',
  'มวยไทย': 'Muay Thai',
  'ชุดใหญ่': 'full force/big set',
  'จน': 'until/to the point',
  'นอน': 'sleep/lie down',
  'คอมเม้นท์': 'comment',
  'ต่างชาติ': 'foreigner/international',
  'เดือด': 'angry/heated'
};

const tooltip = document.createElement('div');
let segmenter = null;
let currentWord = null;

// Check if Intl.Segmenter is supported
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
    console.error("Failed to initialize Intl.Segmenter:", error);
    return false;
  }
};

// Fallback segmentation for unsupported browsers
const fallbackSegment = (text) => {
  return text.split(/[\s\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/).filter(word => word.length > 0);
};

// Segment text into words
const segmentText = (text) => {
  if (segmenter) {
    const segments = segmenter.segment(text);
    return Array.from(segments)
      .filter(segment => segment.isWordLike)
      .map(segment => segment.segment);
  } else {
    return fallbackSegment(text);
  }
};

// --- Popup hover management variables ---
let popupHovered = false;
let wordHovered = false;
let hidePopupTimeout = null;
const POPUP_OFFSET_X = 18; // Slightly increased bias, safer for text height
const POPUP_OFFSET_Y = 20;

// --- Updated tooltip CSS: pointer events ON ---
const initToolTip = () => {
  tooltip.style.position = 'fixed';
  tooltip.style.background = 'rgba(0, 0, 0, 0.95)';
  tooltip.style.color = 'white';
  tooltip.style.border = '2px solid #4CAF50';
  tooltip.style.borderRadius = '6px';
  tooltip.style.padding = '8px 12px';
  tooltip.style.fontSize = '16px';
  tooltip.style.fontFamily = 'Arial, sans-serif';
  tooltip.style.fontWeight = 'normal';
  tooltip.style.zIndex = '2147483647';
  tooltip.style.display = 'none';
  tooltip.style.pointerEvents = 'auto';
  tooltip.style.maxWidth = '300px';
  tooltip.style.wordWrap = 'break-word';
  tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
  tooltip.style.lineHeight = '1.4';
  tooltip.id = 'thai-dict-tooltip';
  document.body.appendChild(tooltip);
  // --- Add hover listeners to tooltip ---
  tooltip.addEventListener('mouseenter', () => {
    popupHovered = true;
    if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  });
  tooltip.addEventListener('mouseleave', () => {
    popupHovered = false;
    delayedHideTooltip();
  });
};

// --- Utility for delayed hide ---
function delayedHideTooltip() {
  if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  hidePopupTimeout = setTimeout(() => {
    if (!popupHovered && !wordHovered) {
      hideTooltip();
    }
  }, 120);
}

// Get text around cursor - simplified version
const getTextAroundCursor = (event) => {
  try {
    let pos = null;
    if (document.caretPositionFromPoint) {
      pos = document.caretPositionFromPoint(event.clientX, event.clientY);
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (range) {
        pos = { offsetNode: range.startContainer, offset: range.startOffset };
      }
    }

    if (!pos || !pos.offsetNode) return null;

    let textNode = pos.offsetNode;
    if (textNode.nodeType !== 3) {
      // Find text node
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
  } catch (error) {
    console.error("Error getting text around cursor:", error);
    return null;
  }
};

// Find word at cursor position
const findWordAtPosition = (segments, context, relativeOffset) => {
  let currentPos = 0;
  
  for (const word of segments) {
    const wordStart = context.indexOf(word, currentPos);
    if (wordStart === -1) continue;
    
    const wordEnd = wordStart + word.length;
    
    if (relativeOffset >= wordStart && relativeOffset <= wordEnd) {
      return {
        word: word.trim(),
        start: wordStart,
        end: wordEnd
      };
    }
    
    currentPos = wordEnd;
  }
  
  return null;
};

let originalTextNode = null; // to store and restore the original text
let originalTextContent = '';
let highlightSpan = null;
let beforeNode = null;  // NEW: Store explicit refs
let afterNode = null;

// --- Highlighted span creation (word) ---
const highlightWord = (textNode, word, wordStart, wordEnd) => {
  removeHighlight();
  if (textNode.nodeType !== 3) return;
  const text = textNode.nodeValue;
  if (text.slice(wordStart, wordEnd) !== word) return;
  const span = document.createElement('span');
  span.textContent = word;
  span.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
  span.style.outline = '2px solid #FFD700';
  span.style.outlineOffset = '1px';
  span.style.borderRadius = '4px';
  span.className = 'thai-highlight-word';
  // --- Make highlighted word interactive ---
  span.addEventListener('mouseenter', () => {
    wordHovered = true;
    if (hidePopupTimeout) clearTimeout(hidePopupTimeout);
  });
  span.addEventListener('mouseleave', () => {
    wordHovered = false;
    delayedHideTooltip();
  });
  beforeNode = document.createTextNode(text.slice(0, wordStart));
  afterNode = document.createTextNode(text.slice(wordEnd));
  const parent = textNode.parentNode;
  originalTextNode = textNode;
  originalTextContent = text;
  highlightSpan = span;
  parent.insertBefore(beforeNode, textNode);
  parent.insertBefore(span, textNode);
  parent.insertBefore(afterNode, textNode);
  parent.removeChild(textNode);
};

// Remove highlight by restoring original text
const removeHighlight = () => {
  if (highlightSpan && originalTextNode && originalTextContent !== '') {
    const parent = highlightSpan.parentNode;
    if (!parent) return;
    // Remove ONLY the nodes we added
    if (highlightSpan.parentNode === parent) parent.removeChild(highlightSpan);
    if (beforeNode && beforeNode.parentNode === parent) parent.removeChild(beforeNode);
    if (afterNode && afterNode.parentNode === parent) parent.removeChild(afterNode);
    parent.insertBefore(originalTextNode, parent.firstChild ? afterNode || parent.firstChild : null);
    originalTextNode.nodeValue = originalTextContent; // restore in-place
  }
  originalTextNode = null;
  originalTextContent = '';
  highlightSpan = null;
  beforeNode = null;
  afterNode = null;
};

// --- Main mouseMove logic, use current cursorRikaikun style offset positioning ---
const mouseMove = (event) => {
  const textData = getTextAroundCursor(event);
  if (!textData) { hideTooltip(); return; }
  const { context, relativeOffset, textNode, absoluteOffset } = textData;
  const thaiRegex = /[\u0E00-\u0E7F]/;
  if (!thaiRegex.test(context)) { hideTooltip(); return; }
  try {
    const segments = segmentText(context);
    const result = findWordAtPosition(segments, context, relativeOffset);
    if (!result) { hideTooltip(); return; }
    const hoveredWord = result.word;
    const wordStart = result.start;
    const wordEnd = result.end;
    const translation = thaiDict[hoveredWord];
    if (!translation) { hideTooltip(); return; }
    if (currentWord === hoveredWord) { return; }
    currentWord = hoveredWord;
    removeHighlight();
    const offset = Math.min(absoluteOffset, textNode.nodeValue.length);
    const contextStart = Math.max(0, offset - 50);
    const absoluteWordStart = contextStart + wordStart;
    const absoluteWordEnd = contextStart + wordEnd;
    highlightWord(textNode, hoveredWord, absoluteWordStart, absoluteWordEnd);
    tooltip.innerHTML = `
      <div style="font-weight: bold; color: #4CAF50; font-size: 18px;">${hoveredWord}</div>
      <div style="margin-top: 4px; color: #ffffff; font-size: 14px;">${translation}</div>
    `;
    // --- Rikaikun-style popup positioning ---
    tooltip.style.display = 'block';
    tooltip.style.visibility = 'hidden';
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    const popupWidth = tooltip.offsetWidth;
    const popupHeight = tooltip.offsetHeight;
    let popupX = event.clientX + POPUP_OFFSET_X;
    let popupY = event.clientY + POPUP_OFFSET_Y;
    if (popupX + popupWidth > window.innerWidth - 8) {
      popupX = window.innerWidth - popupWidth - 8;
    }
    if (popupY + popupHeight > window.innerHeight - 8) {
      popupY = event.clientY - popupHeight - POPUP_OFFSET_Y;
      if (popupY < 8) popupY = 8;
    }
    if (popupX < 8) popupX = 8;
    if (popupY < 8) popupY = 8;
    tooltip.style.left = `${popupX}px`;
    tooltip.style.top = `${popupY}px`;
    tooltip.style.visibility = 'visible';
  } catch {
    hideTooltip();
  }
};

// --- Hide logic now handled only when both not hovered ---
const hideTooltip = () => {
  tooltip.style.display = 'none';
  removeHighlight();
  currentWord = null;
};

// Initialize everything
const init = () => {
  console.log("Initializing...");
  
  const segmenterSupported = initSegmenter();
  if (!segmenterSupported) {
    console.warn("Using fallback segmentation");
  }
  
  initToolTip();
  
  // Add event listeners
  document.addEventListener('mousemove', mouseMove, true);
  document.addEventListener('mouseleave', hideTooltip);
  
  // Test
  const testText = 'ไปไหนดี กินข้าวแล้วหรือยัง';
  const testSegments = segmentText(testText);
  console.log("Test segmentation:", testSegments);
  
  console.log("Initialization complete!");
};

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}