# Research Clipper (rebrand pending)

Local-first web clipper: a Chrome extension clips pages + highlights to a self-hosted library backed by MongoDB.

- Web app: `http://localhost:7331`
- MongoDB: `mongodb://localhost:27017` (via Docker)
- Extension: `extension/dist` (load unpacked)

## Quick start (Docker / OrbStack)

```bash
docker compose up --build
```

Open `http://localhost:7331`.

## Chrome extension

Build:

```bash
bun run --cwd extension build
```

Load unpacked:

1. Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist`

Shortcuts:

- Clip page: `Alt+S`
- Highlight selection (no popup): `Alt+H` (defaults to yellow)

If the popup shows **Server not reachable**, set the server URL (for Docker/OrbStack it’s typically `http://localhost:7331`).

## Repo layout

- `apps/web/`: Next.js web app + API routes
- `extension/`: MV3 Chrome extension (service worker + content script)
- `docker-compose.yml`: Mongo + web app container

## Docs

More detailed setup and troubleshooting: `SETUP.md`

