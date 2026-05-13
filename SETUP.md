# Running the Clipper (rebrand pending)

Two ways to run it. **Docker is the easiest** — one command, everything included.

---

## Option A — Docker (Recommended)

Starts MongoDB + the app together. No installs needed beyond Docker.

**Prerequisites:** Docker Desktop or OrbStack (Docker-compatible) must be running.

```bash
cd /Users/nr/Developer/researchPaper
docker compose up --build
```

First run takes ~2 minutes to build. After that, open:

```
http://localhost:7331
```

To stop: `Ctrl+C`, then `docker compose down`.

---

## Option B — Local dev (faster iteration)

You need MongoDB running separately. Two sub-options:

### B1 — MongoDB via Docker (just the DB)

```bash
docker run -d --name moonlit-mongo \
  -p 27017:27017 \
  -v moonlit_data:/data/db \
  mongo:7
```

Then in a new terminal:

```bash
cd /Users/nr/Developer/researchPaper/apps/web
bun run server.ts
```

Open `http://localhost:7331`.

### B2 — MongoDB Atlas (cloud, no Docker at all)

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Get your connection string (looks like `mongodb+srv://user:pass@cluster.mongodb.net/moonlit`)
3. Edit `/Users/nr/Developer/researchPaper/.env`:

```bash
# Uncomment and fill in:
ATLAS_URI=mongodb+srv://user:pass@cluster.mongodb.net/moonlit
```

4. Run:

```bash
cd /Users/nr/Developer/researchPaper/apps/web
bun run server.ts
```

---

## Load the Chrome Extension

Do this once, regardless of which option you chose above:

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select the folder: `/Users/nr/Developer/researchPaper/extension/dist`

The 🦩 flamingo icon appears in your toolbar. Click it — it shows green "App running" when the app is up.

---

## Rebuild the extension after code changes

```bash
cd /Users/nr/Developer/researchPaper
bun run --cwd extension build
```

Then go to `chrome://extensions/` and click the refresh icon on the Moonlit Flamingo card.

---

## Using it

1. **Clip a page:** Visit any article → click the extension icon → "Clip this page"  
   Or use the shortcut: `Alt+S`

2. **Highlight (no overlay UI):** Select text → press `Alt+H`  
   This creates a yellow highlight and syncs it to the reader view.

3. **Export for AI:** Open any article in the app → click "↓ Export MD" → paste into Claude

---

## Troubleshooting

**`connect ECONNREFUSED 127.0.0.1:27017`**  
MongoDB is not running. Use Option A (Docker Compose) or start it manually (Option B1/B2).

**`Only plain objects can be passed to Client Components`**  
Dates from MongoDB need serialization — run a `bun run build` restart to pick up the fix, or use Docker Compose which runs production mode.

**Extension shows "Server not reachable" / "App offline"**  
- Verify the server is up: `curl http://localhost:7331/api/health`
- In the extension popup, set the Server URL to match your Docker/OrbStack published port (usually `http://localhost:7331`)

**Port 7331 already in use**  
```bash
lsof -ti:7331 | xargs kill
```

---

## Switch to Atlas later

To sync with a future phone app, just set `ATLAS_URI` in `.env` and restart. The app writes there automatically — no code changes needed.
