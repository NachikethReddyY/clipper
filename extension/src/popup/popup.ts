import { getDefaultServerBase, getServerBase, setServerBase } from '../shared/config';
import { fetchWithTimeout } from '../shared/http';

async function init() {
  const dot = document.getElementById('status-dot')!;
  const statusText = document.getElementById('status-text')!;
  const body = document.getElementById('body')!;
  const openApp = document.getElementById('open-app')!;

  const base = await getServerBase();
  openApp.setAttribute('href', base);

  let appRunning = false;
  let lastError: unknown = null;
  // Retry twice — first attempt sometimes fails due to extension context init
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchWithTimeout(`${base}/api/health`, { timeoutMs: 3000, cache: 'no-store' });
      if (res.ok) { appRunning = true; break; }
    } catch (e) { lastError = e; }
    if (i === 0) await new Promise(r => setTimeout(r, 400));
  }

  dot.className = `dot ${appRunning ? 'on' : 'off'}`;
  statusText.textContent = appRunning ? 'App running' : 'App offline';

  if (!appRunning) {
    body.innerHTML = `
      <div class="offline-msg">
        <div style="font-size:20px;margin-bottom:6px">🦩</div>
        Server not reachable.<br><br>
        <div style="text-align:left;font-size:11px;line-height:1.35">
          <div style="color:#888;margin-bottom:4px">Server URL</div>
          <input id="server-url" style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid #333;background:#0b0b0b;color:#e8e8e8" value="${escAttr(base)}" />
          <button id="save-server-url" style="margin-top:8px;width:100%;background:#1f2937;border:1px solid #374151;color:#e8e8e8;border-radius:6px;padding:7px;cursor:pointer">Save</button>
          <div style="margin-top:10px;color:#888">
            Expected health endpoint:<br>
            <code style="color:#f97316;font-size:11px">${escHtml(base)}/api/health</code>
          </div>
          ${lastError ? `<div style="margin-top:8px;color:#666;word-break:break-all">Last error: ${escHtml(String(lastError))}</div>` : ''}
          <div style="margin-top:10px;color:#666">
            If you’re using Docker/OrbStack, make sure ports are published:<br>
            <code style="color:#f97316;font-size:11px">7331:7331</code>
          </div>
        </div>
      </div>
    `;
    const input = document.getElementById('server-url') as HTMLInputElement | null;
    const saveBtn = document.getElementById('save-server-url') as HTMLButtonElement | null;
    if (input && saveBtn) {
      saveBtn.onclick = async () => {
        const nextBase = await setServerBase(input.value || getDefaultServerBase());
        openApp.setAttribute('href', nextBase);
        // Re-run init to refresh status immediately
        init();
      };
    }
    return;
  }

  openApp.style.display = 'block';

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url || '';
  const isClippable = currentUrl.startsWith('http');

  // Check if current page is already clipped
  let currentClip: { _id: string; title: string } | null = null;
  if (isClippable) {
    try {
      const res = await fetchWithTimeout(`${base}/api/clips?limit=200`, { timeoutMs: 5000 });
      const { clips } = await res.json();
      currentClip = clips.find((c: { url: string }) => c.url === currentUrl || c.url === currentUrl.replace(/\/$/, '')) || null;
    } catch { /* ignore */ }
  }

  // Recent clips
  let recentClips: { _id: string; title: string; siteName?: string }[] = [];
  try {
    const res = await fetchWithTimeout(`${base}/api/clips?limit=5`, { timeoutMs: 5000 });
    const { clips } = await res.json();
    recentClips = clips;
  } catch { /* ignore */ }

  const clipBtnLabel = currentClip ? '✓ Already clipped' : '+ Clip this page';
  const clipBtnDisabled = !isClippable || !!currentClip;

  body.innerHTML = `
    ${currentClip ? `
      <button class="clip-btn" id="open-reader-btn" style="background:#111827;border:1px solid #374151;margin-bottom:10px">
        Open reader ↗
      </button>
    ` : ''}
    <button class="clip-btn" id="clip-btn" ${clipBtnDisabled ? 'disabled' : ''}>
      ${clipBtnLabel}
    </button>
    ${recentClips.length > 0 ? `
      <div class="section-title">Recent</div>
      ${recentClips.map(c => `
        <a href="${base}/article/${c._id}" target="_blank" class="clip-item">
          <div style="flex:1;min-width:0">
            <div class="clip-title">${escHtml(c.title)}</div>
            ${c.siteName ? `<div class="clip-site">${escHtml(c.siteName)}</div>` : ''}
          </div>
        </a>
      `).join('')}
    ` : ''}
  `;

  if (currentClip) {
    document.getElementById('open-reader-btn')!.onclick = async () => {
      chrome.tabs.create({ url: `${base}/article/${currentClip!._id}` });
      window.close();
    };
  }

  if (!clipBtnDisabled) {
    document.getElementById('clip-btn')!.onclick = async () => {
      const btn = document.getElementById('clip-btn') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Clipping...';

      try {
        const result: { success: boolean; clipId?: string; existed?: boolean; error?: string } =
          await chrome.tabs.sendMessage(tab!.id!, { type: 'CLIP_PAGE' });

        if (result?.success) {
          if (result.queued) btn.textContent = '✓ Queued (offline)';
          else btn.textContent = result.existed ? '✓ Already in library' : '✓ Clipped!';
          if (result.clipId) chrome.tabs.create({ url: `${base}/article/${result.clipId}` });
          setTimeout(() => window.close(), 1200);
        } else {
          btn.textContent = '✗ Failed';
          btn.style.background = '#ef4444';
          const errEl = document.createElement('div');
          errEl.style.cssText = 'font-size:11px;color:#ef4444;margin-top:6px;word-break:break-all;';
          errEl.textContent = result?.error || 'Unknown error';
          btn.after(errEl);
          btn.disabled = false;
        }
      } catch (e) {
        // Content script not injected (e.g. chrome:// page, extension page, or not yet loaded)
        btn.textContent = '✗ Cannot clip this page';
        btn.style.background = '#ef4444';
        const errEl = document.createElement('div');
        errEl.style.cssText = 'font-size:11px;color:#888;margin-top:6px;';
        errEl.textContent = 'Try refreshing the page first.';
        btn.after(errEl);
        btn.disabled = false;
      }
    };
  }
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string) {
  return escHtml(s).replace(/'/g, '&#39;');
}

init();
