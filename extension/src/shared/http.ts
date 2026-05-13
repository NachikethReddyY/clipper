export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 3000, signal, ...rest } = init;

  // `AbortSignal.timeout()` isn't available in all extension runtimes.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const signals: AbortSignal[] = [controller.signal];
  if (signal) signals.push(signal);

  const combined = anyAbort(signals);
  try {
    return await fetch(url, { ...rest, signal: combined });
  } finally {
    clearTimeout(timeoutId);
  }
}

function anyAbort(signals: AbortSignal[]) {
  if (signals.length === 1) return signals[0];

  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

