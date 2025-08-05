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
  'ชายแดน': 'border'
};

const tooltip = document.createElement('div');
let segmenter = null;

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
  // Simple fallback: split by spaces and common punctuation
  // Not ideal for Thai, but better than nothing
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
  tooltip.style.zIndex = '2147483647'; // Maximum z-index
  tooltip.style.display = 'none';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.maxWidth = '300px';
  tooltip.style.wordWrap = 'break-word';
  tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
  tooltip.style.lineHeight = '1.4';
  tooltip.id = 'thai-dict-tooltip';
  
  // Make sure it's added to body
  document.body.appendChild(tooltip);
  console.log("Tooltip created and added to body:", tooltip);
};

// Get Thai text around cursor position (improved compatibility)
const getTextAroundCursor = (event) => {
  try {
    // Try modern API first
    let pos = null;
    if (document.caretPositionFromPoint) {
      pos = document.caretPositionFromPoint(event.clientX, event.clientY);
    } else if (document.caretRangeFromPoint) {
      // Webkit fallback
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (range) {
        pos = {
          offsetNode: range.startContainer,
          offset: range.startOffset
        };
      }
    }

    if (!pos || !pos.offsetNode) return null;

    // Make sure we're in a text node
    let textNode = pos.offsetNode;
    if (textNode.nodeType !== 3) {
      // If not a text node, try to find a text node child
      const walker = document.createTreeWalker(
        textNode,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      textNode = walker.nextNode();
      if (!textNode) return null;
      pos.offset = 0; // Reset offset for new node
    }

    const text = textNode.nodeValue;
    if (!text) return null;

    const offset = Math.min(pos.offset, text.length);
    // Get more context around the cursor
    const contextStart = Math.max(0, offset - 50);
    const contextEnd = Math.min(text.length, offset + 50);
    const context = text.slice(contextStart, contextEnd);
    
    return {
      context,
      relativeOffset: offset - contextStart,
      textNode
    };
  } catch (error) {
    console.error("Error getting text around cursor:", error);
    return null;
  }
};

// Find word at specific position in segmented text
const findWordAtPosition = (segments, context, relativeOffset) => {
  let currentPos = 0;
  
  for (const word of segments) {
    const wordStart = context.indexOf(word, currentPos);
    if (wordStart === -1) continue;
    
    const wordEnd = wordStart + word.length;
    
    if (relativeOffset >= wordStart && relativeOffset <= wordEnd) {
      return word.trim();
    }
    
    currentPos = wordEnd;
  }
  
  return null;
};

// Handle mouse movement (improved debugging and compatibility)
const mouseMove = (event) => {
  // Add debug logging to see if function is called
  console.log("mouseMove called at:", event.clientX, event.clientY);
  
  const textData = getTextAroundCursor(event);
  if (!textData) {
    console.log("No text data found");
    tooltip.style.display = 'none';
    return;
  }

  const { context, relativeOffset, textNode } = textData;
  console.log("Context found:", context.substring(0, 20) + "...", "Offset:", relativeOffset);
  
  // Check if context contains Thai characters
  const thaiRegex = /[\u0E00-\u0E7F]/;
  if (!thaiRegex.test(context)) {
    console.log("No Thai characters found in context");
    tooltip.style.display = 'none';
    return;
  }

  try {
    const segments = segmentText(context);
    console.log("Segments:", segments);
    
    const hoveredWord = findWordAtPosition(segments, context, relativeOffset);
    console.log("Hovered word:", hoveredWord);
    
    if (!hoveredWord) {
      tooltip.style.display = 'none';
      return;
    }

    // Check if we have a translation for this word
    const translation = thaiDict[hoveredWord];
    if (!translation) {
      console.log("No translation found for:", hoveredWord);
      tooltip.style.display = 'none';
      return;
    }

    console.log("Showing translation:", hoveredWord, "->", translation);

    // Show tooltip with enhanced styling and positioning
    tooltip.innerHTML = `
      <div style="font-weight: bold; color: #4CAF50; font-size: 18px;">${hoveredWord}</div>
      <div style="margin-top: 4px; color: #ffffff; font-size: 14px;">${translation}</div>
    `;
    
    // Better positioning to avoid edge cases
    let tooltipX = event.clientX + 15;
    let tooltipY = event.clientY - 60;
    
    // Adjust if tooltip would go off screen
    if (tooltipX + 250 > window.innerWidth) {
      tooltipX = event.clientX - 250;
    }
    if (tooltipY < 0) {
      tooltipY = event.clientY + 20;
    }
    
    tooltip.style.left = `${tooltipX}px`;
    tooltip.style.top = `${tooltipY}px`;
    tooltip.style.display = 'block';
    tooltip.style.visibility = 'visible';
    tooltip.style.opacity = '1';
    
    console.log("Tooltip positioned at:", tooltipX, tooltipY);
    console.log("Tooltip display:", tooltip.style.display);
    console.log("Tooltip visibility:", tooltip.style.visibility);
    
  } catch (error) {
    console.error("Error processing text:", error);
    tooltip.style.display = 'none';
  }
};

// Hide tooltip when mouse leaves
const mouseLeave = () => {
  tooltip.style.display = 'none';
};

// Initialize everything
const init = () => {
  console.log("Initializing Thai Dictionary Extension...");
  
  const segmenterSupported = initSegmenter();
  
  if (!segmenterSupported) {
    console.warn("Using fallback segmentation - word detection may be less accurate for Thai text");
  }
  
  initToolTip();
  
  // Add event listeners with debugging
  console.log("Adding event listeners...");
  document.addEventListener('mousemove', mouseMove, true); // Use capture phase
  document.addEventListener('mouseleave', mouseLeave);
  
  // Test basic mouse event
  let testCount = 0;
  const testMouseMove = (e) => {
    if (testCount < 3) {
      console.log("Basic mouse move detected:", e.clientX, e.clientY);
      testCount++;
    }
  };
  document.addEventListener('mousemove', testMouseMove);
  
  // Test the segmenter
  const testText = 'ไปไหนดี กินข้าวแล้วหรือยัง';
  const testSegments = segmentText(testText);
  console.log("Test segmentation:", testSegments);
  
  // Test tooltip visibility
  console.log("Testing tooltip creation...");
  console.log("Tooltip element:", tooltip);
  console.log("Tooltip parent:", tooltip.parentNode);
  
  console.log("Initialization complete!");
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}