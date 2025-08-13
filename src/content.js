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

// Create tooltip (with better styling and z-index)
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
  tooltip.style.pointerEvents = 'none';
  tooltip.style.maxWidth = '300px';
  tooltip.style.wordWrap = 'break-word';
  tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
  tooltip.style.lineHeight = '1.4';
  tooltip.id = 'thai-dict-tooltip';
  
  document.body.appendChild(tooltip);
  console.log("Tooltip created and added to body");
};

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

// Simple highlighting using CSS outline
const highlightWord = (element, word) => {
  element.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
  element.style.outline = '2px solid #FFD700';
  element.style.outlineOffset = '1px';
  console.log("element: ", element)
  console.log("word: ", word)
};

const removeHighlight = (element) => {
  if (element) {
    element.style.backgroundColor = '';
    element.style.outline = '';
    element.style.outlineOffset = '';
  }
};

let highlightedElement = null;

// Handle mouse movement - simplified
const mouseMove = (event) => {
  console.log("mouseMove called");
  
  const textData = getTextAroundCursor(event);
  if (!textData) {
    console.log("No text data");
    hideTooltip();
    return;
  }

  const { context, relativeOffset } = textData;
  
  // Check for Thai characters
  const thaiRegex = /[\u0E00-\u0E7F]/;
  if (!thaiRegex.test(context)) {
    console.log("No Thai text");
    hideTooltip();
    return;
  }

  try {
    const segments = segmentText(context);
    console.log("Segments:", segments);
    
    const result = findWordAtPosition(segments, context, relativeOffset);
    if (!result) {
      console.log("No word found at position");
      hideTooltip();
      return;
    }

    const hoveredWord = result.word;
    console.log("Hovered word:", hoveredWord);

    // Check if we have translation
    const translation = thaiDict[hoveredWord];
    if (!translation) {
      console.log("No translation for:", hoveredWord);
      hideTooltip();
      return;
    }

    // Don't update if same word
    if (currentWord === hoveredWord) {
      return;
    }

    currentWord = hoveredWord;
    console.log("Showing translation:", hoveredWord, "->", translation);

    // Remove previous highlight
    if (highlightedElement) {
      removeHighlight(highlightedElement);
    }

    // Try to highlight current element
    const element = event.target;
    if (element && element.nodeType === 1) {
      highlightWord(element, hoveredWord);
      highlightedElement = element;
    }

    // Show tooltip
    tooltip.innerHTML = `
      <div style="font-weight: bold; color: #4CAF50; font-size: 18px;">${hoveredWord}</div>
      <div style="margin-top: 4px; color: #ffffff; font-size: 14px;">${translation}</div>
    `;
    
    // Position tooltip
    let tooltipX = event.clientX + 15;
    let tooltipY = event.clientY - 60;
    
    if (tooltipX + 250 > window.innerWidth) {
      tooltipX = event.clientX - 250;
    }
    if (tooltipY < 0) {
      tooltipY = event.clientY + 20;
    }
    
    tooltip.style.left = `${tooltipX}px`;
    tooltip.style.top = `${tooltipY}px`;
    tooltip.style.display = 'block';
    
  } catch (error) {
    console.error("Error in mouseMove:", error);
    hideTooltip();
  }
};

const hideTooltip = () => {
  tooltip.style.display = 'none';
  if (highlightedElement) {
    removeHighlight(highlightedElement);
    highlightedElement = null;
  }
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