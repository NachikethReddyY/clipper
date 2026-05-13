import { getServerBase } from '../shared/config';
import { fetchWithTimeout } from '../shared/http';

type OutboxItem =
  | { id: string; type: 'clip'; payload: Record<string, unknown>; createdAt: number }
  | { id: string; type: 'highlight'; payload: Record<string, unknown>; createdAt: number };

const OUTBOX_KEY = 'outbox';
const FLUSH_ALARM = 'flush-outbox';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clip-page',
    title: 'Clip to Moonlit Flamingo',
    contexts: ['page', 'selection'],
  });

  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
});

chrome.contextMenus.onClicked.addListener(async (_info, tab) => {
  if (tab?.id) await clipAndOpen(tab.id);
});

// Hotkey Alt+S
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'clip-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await clipAndOpen(tab.id);
  }
  if (command === 'highlight-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await ensureContentScript(tab.id);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_SELECTION', color: 'yellow' });
    } catch (e) {
      console.error('[Moonlit] highlight-selection failed:', e);
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) void flushOutbox();
});

async function ensureContentScript(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 300));
  }
}

async function clipAndOpen(tabId: number) {
  await ensureContentScript(tabId);

  // Ask content script to extract page data (DOM access needed)
  let payload: Record<string, unknown>;
  try {
    payload = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' });
  } catch (e) {
    console.error('[Moonlit] Could not extract page data:', e);
    return;
  }

  // SW does the actual fetch — not subject to page CSP
  const result = await doClip(payload);
  if (result?.clipId) {
    const base = await getServerBase();
    chrome.tabs.create({ url: `${base}/article/${result.clipId}` });
  }
}

async function isServerReachable() {
  try {
    const base = await getServerBase();
    const res = await fetchWithTimeout(`${base}/api/health`, { timeoutMs: 2000, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadOutbox(): Promise<OutboxItem[]> {
  const data = await chrome.storage.local.get(OUTBOX_KEY);
  return ((data as Record<string, unknown>)[OUTBOX_KEY] as OutboxItem[]) || [];
}

async function saveOutbox(items: OutboxItem[]) {
  await chrome.storage.local.set({ [OUTBOX_KEY]: items });
}

function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

async function enqueue(item: Omit<OutboxItem, 'id'>) {
  const outbox = await loadOutbox();
  outbox.push({ ...item, id: newId() } as OutboxItem);
  await saveOutbox(outbox);
}

async function flushOutbox() {
  const reachable = await isServerReachable();
  if (!reachable) return;

  const base = await getServerBase();
  const outbox = await loadOutbox();
  if (outbox.length === 0) return;

  const remaining: OutboxItem[] = [];
  for (const item of outbox) {
    try {
      const url = item.type === 'clip' ? `${base}/api/clips` : `${base}/api/highlights`;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
        timeoutMs: 15_000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      remaining.push(item);
    }
  }

  if (remaining.length !== outbox.length) await saveOutbox(remaining);
}

// All API fetches happen here in the SW, never in content scripts
async function doClip(payload: Record<string, unknown> | null) {
  if (!payload) return { success: false, error: 'Missing payload' };
  try {
    const base = await getServerBase();
    const res = await fetchWithTimeout(`${base}/api/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 15_000,
    });
    if (!res.ok) {
      console.error('[Moonlit] clip failed:', res.status, await res.text());
      return { success: false, error: `HTTP ${res.status}` };
    }
    const { clip, existed } = await res.json();
    void flushOutbox();
    return { success: true, clipId: clip._id, existed };
  } catch (e) {
    console.error('[Moonlit] clip fetch error:', e);
    // If the server is down, queue it and let an alarm flush in the background.
    await enqueue({ type: 'clip', payload, createdAt: Date.now() });
    return { success: true, queued: true };
  }
}

async function doCreateHighlight(payload: Record<string, unknown>) {
  try {
    const base = await getServerBase();
    const res = await fetchWithTimeout(`${base}/api/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 15_000,
    });
    const data = await res.json();
    void flushOutbox();
    return { success: true, highlight: data.highlight };
  } catch (e) {
    await enqueue({ type: 'highlight', payload, createdAt: Date.now() });
    return { success: true, queued: true };
  }
}

// Message relay from content scripts → SW → API
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CLIP_VIA_SW') {
    doClip(msg.payload).then(sendResponse);
    return true;
  }
  if (msg.type === 'HIGHLIGHT_VIA_SW') {
    doCreateHighlight(msg.payload).then(sendResponse);
    return true;
  }
  if (msg.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
});
