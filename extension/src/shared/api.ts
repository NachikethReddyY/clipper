import { getServerBase } from './config';
import { fetchWithTimeout } from './http';

export async function checkHealth(): Promise<boolean> {
  try {
    const base = await getServerBase();
    const res = await fetchWithTimeout(`${base}/api/health`, { timeoutMs: 2000, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clipPage(data: {
  url: string;
  title: string;
  rawHtml: string;
  author?: string;
  siteName?: string;
  coverImageUrl?: string;
}) {
  const base = await getServerBase();
  const res = await fetchWithTimeout(`${base}/api/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    timeoutMs: 10_000,
  });
  return res.json();
}

export async function createHighlight(data: {
  clipId: string;
  anchor: { containerXPath: string; startOffset: number; endOffset: number; textSnippet: string };
  selectedText: string;
  color: string;
  note?: string;
}) {
  const base = await getServerBase();
  const res = await fetchWithTimeout(`${base}/api/highlights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    timeoutMs: 10_000,
  });
  return res.json();
}

export async function getClipByUrl(url: string) {
  const base = await getServerBase();
  const res = await fetchWithTimeout(`${base}/api/clips?q=${encodeURIComponent(url)}`, { timeoutMs: 5000 });
  const { clips } = await res.json();
  return clips.find((c: { url: string }) => c.url === url) || null;
}

export async function getRecentClips(limit = 5) {
  const base = await getServerBase();
  const res = await fetchWithTimeout(`${base}/api/clips?limit=${limit}`, { timeoutMs: 5000 });
  const { clips } = await res.json();
  return clips;
}
