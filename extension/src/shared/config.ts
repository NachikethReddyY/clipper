const DEFAULT_BASE = 'http://localhost:7331';
const STORAGE_KEY = 'serverBase';

let cachedBase: string | null = null;

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BASE;
  return trimmed.replace(/\/+$/, '');
}

export async function getServerBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  cachedBase = normalizeBase((data as Record<string, unknown>)[STORAGE_KEY] as string || DEFAULT_BASE);
  return cachedBase;
}

export async function setServerBase(base: string): Promise<string> {
  const normalized = normalizeBase(base);
  cachedBase = normalized;
  await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export function getDefaultServerBase(): string {
  return DEFAULT_BASE;
}

