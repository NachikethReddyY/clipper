// MUST stay in sync with apps/web/lib/anchor.ts logic

export interface HighlightAnchor {
  containerXPath: string;
  startOffset: number;
  endOffset: number;
  textSnippet: string;
}

export function captureAnchor(selection: Selection): HighlightAnchor | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.TEXT_NODE
    ? (container.parentElement as Element)
    : (container as Element);

  // Walk text nodes to compute absolute offsets within the element
  let startOffset = 0;
  let endOffset = 0;
  let found = false;
  let charCount = 0;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node === range.startContainer) {
      startOffset = charCount + range.startOffset;
    }
    if (node === range.endContainer) {
      endOffset = charCount + range.endOffset;
      found = true;
      break;
    }
    charCount += node.length;
  }

  if (!found) return null;

  return {
    containerXPath: getXPath(element),
    startOffset,
    endOffset,
    textSnippet: selection.toString().slice(0, 40),
  };
}

function getXPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = node.parentElement;
  }

  return '//' + parts.join('/');
}
