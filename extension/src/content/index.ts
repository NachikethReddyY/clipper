import { captureAnchor } from './anchor';
import { Readability } from '@mozilla/readability';
import { getServerBase } from '../shared/config';
import { fetchWithTimeout } from '../shared/http';

const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
const COLOR_CSS: Record<string, string> = {
  yellow: 'rgba(253,224,71,0.5)',
  green: 'rgba(74,222,128,0.45)',
  blue: 'rgba(96,165,250,0.45)',
  pink: 'rgba(244,114,182,0.45)',
  purple: 'rgba(167,139,250,0.45)',
};

let toolbar: HTMLElement | null = null;
let currentClipId: string | null = null;

// ─── Check if this page has been clipped ─────────────────────────────────────
async function checkClipStatus() {
  // Use SW-proxied fetch to look up by URL
  try {
    const base = await getServerBase();
    const res = await fetchWithTimeout(`${base}/api/clips?limit=200`, {
      // content script fetch — may be blocked by page CSP on some sites
      // but this is read-only and less critical; SW already handles writes
      timeoutMs: 5000,
    });
    if (!res.ok) return;
    const { clips } = await res.json();
    const match = clips.find((c: { url: string; _id: string }) =>
      c.url === location.href || c.url === location.href.replace(/\/$/, '')
    );
    if (match) {
      currentClipId = match._id;
      renderExistingHighlights(match._id);
    }
  } catch { /* app not running or CSP blocked — not critical */ }
}

async function renderExistingHighlights(clipId: string) {
  try {
    const base = await getServerBase();
    const res = await fetchWithTimeout(`${base}/api/highlights?clipId=${clipId}`, { timeoutMs: 5000 });
    const { highlights } = await res.json();
    for (const h of highlights) applyMarkToPage(h);
  } catch { /* ignore */ }
}

function applyMarkToPage(h: { _id: string; anchor: { containerXPath: string; startOffset: number; endOffset: number }; color: string }) {
  try {
    const result = document.evaluate(h.anchor.containerXPath, document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result.singleNodeValue as Element | null;
    if (!node) return;

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let startNode: Text | null = null, startOff = 0, endNode: Text | null = null, endOff = 0;
    let textNode: Text | null;

    while ((textNode = walker.nextNode() as Text | null)) {
      const len = textNode.length;
      if (!startNode && charCount + len > h.anchor.startOffset) {
        startNode = textNode; startOff = h.anchor.startOffset - charCount;
      }
      if (!endNode && charCount + len >= h.anchor.endOffset) {
        endNode = textNode; endOff = h.anchor.endOffset - charCount; break;
      }
      charCount += len;
    }

    if (!startNode || !endNode) return;
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    const mark = document.createElement('mark');
    mark.setAttribute('data-highlight-id', h._id);
    mark.style.cssText = `background:${COLOR_CSS[h.color]};border-radius:2px;`;
    range.surroundContents(mark);
  } catch { /* stale anchor */ }
}

// ─── Selection toolbar ────────────────────────────────────────────────────────
// Disabled by default — use keyboard shortcut `Alt+H` to highlight without UI overlays.
// (Users requested no overlay when selecting text on pages.)
const ENABLE_SELECTION_TOOLBAR = false;
if (ENABLE_SELECTION_TOOLBAR) {
  document.addEventListener('mouseup', (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { removeToolbar(); return; }
    if ((e.target as Element).closest('#mf-toolbar')) return;
    removeToolbar();
    showToolbar(e.clientX, e.clientY, sel);
  });

  document.addEventListener('mousedown', (e) => {
    if (!(e.target as Element).closest('#mf-toolbar')) removeToolbar();
  });
}

function showToolbar(x: number, y: number, sel: Selection) {
  toolbar = document.createElement('div');
  toolbar.id = 'mf-toolbar';
  toolbar.style.cssText = `
    position:fixed;left:${x}px;top:${y - 50}px;
    background:#1a1a1a;border:1px solid #333;border-radius:8px;
    padding:6px 8px;display:flex;gap:6px;align-items:center;
    z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-size:12px;
  `;

  const label = document.createElement('span');
  label.textContent = currentClipId ? '🦩' : '⚡ Clip first';
  label.style.cssText = 'color:#888;margin-right:2px;';
  toolbar.appendChild(label);

  for (const color of COLORS) {
    const btn = document.createElement('button');
    btn.style.cssText = `width:18px;height:18px;border-radius:50%;border:2px solid transparent;
      background:${COLOR_CSS[color]};cursor:pointer;padding:0;transition:transform 0.1s;`;
    btn.title = color;
    btn.onmouseenter = () => (btn.style.transform = 'scale(1.2)');
    btn.onmouseleave = () => (btn.style.transform = 'scale(1)');
    btn.onclick = () => handleHighlight(sel, color);
    toolbar.appendChild(btn);
  }

  if (!currentClipId) {
    const clipBtn = document.createElement('button');
    clipBtn.textContent = '+ Clip page';
    clipBtn.style.cssText = `background:#f97316;border:none;border-radius:4px;
      color:#fff;padding:3px 8px;cursor:pointer;font-size:11px;margin-left:4px;`;
    clipBtn.onclick = () => triggerClip();
    toolbar.appendChild(clipBtn);
  }

  document.body.appendChild(toolbar);
}

function removeToolbar() { toolbar?.remove(); toolbar = null; }

async function handleHighlight(sel: Selection, color: string) {
  if (!currentClipId) { alert('Clip this page first.'); removeToolbar(); return; }
  const anchor = captureAnchor(sel);
  if (!anchor) { removeToolbar(); return; }
  const selectedText = sel.toString();
  removeToolbar();
  sel.removeAllRanges();

  // Route through SW to avoid page CSP
  const result = await chrome.runtime.sendMessage({
    type: 'HIGHLIGHT_VIA_SW',
    payload: { clipId: currentClipId, anchor, selectedText, color },
  });

  if (result?.highlight) applyMarkToPage(result.highlight);
}

// ─── Page extraction (called by SW when clipping) ────────────────────────────
function extractPage() {
  const docClone = document.cloneNode(true) as Document;
  const article = new Readability(docClone).parse();

  const readableHtml = article?.content || document.body.innerHTML;
  const textContent = article?.textContent || document.body.innerText || '';
  const wordCount = textContent.split(/\s+/).filter(Boolean).length;

  return {
    url: location.href,
    title: article?.title || document.title,
    readableHtml,
    textContent,
    wordCount,
    author: article?.byline || document.querySelector('meta[name="author"]')?.getAttribute('content') || undefined,
    siteName: article?.siteName || document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || undefined,
    excerpt: article?.excerpt || textContent.slice(0, 280) || undefined,
    coverImageUrl: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || undefined,
  };
}

// Also usable from the highlight toolbar's "Clip page" button
async function triggerClip() {
  removeToolbar();
  showToast('⏳ Clipping...');
  const payload = extractPage();
  const result = await chrome.runtime.sendMessage({ type: 'CLIP_VIA_SW', payload });
  if (result?.success && result?.clipId) {
    currentClipId = result.clipId;
    showToast('✓ Clipped! Open reader: ' + result.clipId);
  } else if (result?.queued) {
    showToast('✓ Queued (offline) — will sync when server is reachable');
  } else {
    showToast('⚠ Clip failed: ' + (result?.error || 'unknown'));
  }
  return result;
}

async function clipSilentlyIfNeeded() {
  if (currentClipId) return { ok: true, clipId: currentClipId };
  const payload = extractPage();
  const result = await chrome.runtime.sendMessage({ type: 'CLIP_VIA_SW', payload });
  if (result?.success && result?.clipId) {
    currentClipId = result.clipId;
    return { ok: true, clipId: currentClipId };
  }
  if (result?.queued) return { ok: false, queued: true };
  return { ok: false, error: result?.error || 'clip failed' };
}

async function highlightCurrentSelection(color: string) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    return { success: false, error: 'No selection' };
  }

  const ensure = await clipSilentlyIfNeeded();
  if (!ensure.ok) {
    if ((ensure as { queued?: boolean }).queued) return { success: false, error: 'Offline (clip queued). Try again once synced.' };
    return { success: false, error: (ensure as { error?: string }).error || 'Could not clip' };
  }

  const anchor = captureAnchor(sel);
  if (!anchor) return { success: false, error: 'Could not capture anchor' };

  const selectedText = sel.toString();
  sel.removeAllRanges();

  const result = await chrome.runtime.sendMessage({
    type: 'HIGHLIGHT_VIA_SW',
    payload: { clipId: currentClipId, anchor, selectedText, color },
  });

  if (result?.highlight) {
    applyMarkToPage(result.highlight);
    return { success: true, highlightId: result.highlight._id };
  }
  if (result?.queued) return { success: true, queued: true };
  return { success: false, error: result?.error || 'highlight failed' };
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'EXTRACT_PAGE') {
    try {
      sendResponse(extractPage());
    } catch (e) {
      sendResponse({ error: String(e) });
    }
    return false;
  }
  if (msg.type === 'CLIP_PAGE') {
    // Legacy: popup button still sends this; proxy through SW
    triggerClip()
      .then((result) => {
        if (result?.queued) return sendResponse({ success: true, queued: true });
        return sendResponse({ success: !!currentClipId, clipId: currentClipId || undefined, existed: result?.existed });
      })
      .catch(e => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'HIGHLIGHT_SELECTION') {
    highlightCurrentSelection(msg.color || 'yellow')
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: String(e) }));
    return true;
  }
});

function showToast(msg: string) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1a1a1a;
    border:1px solid #f97316;color:#e8e8e8;padding:10px 16px;border-radius:8px;
    font-size:13px;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.4);`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

checkClipStatus();
