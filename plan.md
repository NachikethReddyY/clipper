# Moonlit Flamingo — Research Tool Plan

> Obsidian Web Clipper + Instapaper. Cloud-synced, Dockerized, real-time highlights everywhere.

---

## What We're Building

Three parts that work together:

| Part | Description |
|---|---|
| **Docker Stack** | MongoDB + Next.js server in a single `docker-compose up` |
| **React App** | Runs in your browser at `localhost:7331` — library, reader, real-time highlights |
| **Chrome Extension** | Clips pages + highlights text from any website; syncs instantly |

**Data flow:** Extension → Next.js API → MongoDB Atlas (cloud) ← syncs to → local Docker MongoDB ← phones/other clients

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| App framework | Next.js 15 App Router | Full-stack, API routes + UI |
| Database (cloud) | MongoDB Atlas (free tier) | Source of truth, phone app sync |
| Database (local) | MongoDB in Docker | Local mirror, works offline |
| Sync | Mongoose writes to Atlas; Docker Mongo is a local replica | One connection string env var swaps them |
| Real-time | Socket.io | Live highlights in app + on live pages |
| Article extraction | Mozilla Readability.js (server-side) | Clean article body |
| HTML → Markdown | Turndown.js + GFM plugin | AI-ready export |
| Highlight anchoring | XPath + text offsets | Survives page reloads |
| Styling | Tailwind CSS 4 + shadcn/ui | Dense research UI |
| Extension | Chrome MV3 | Standard, future-proof |
| Containerization | Docker Compose | `docker-compose up` → everything running |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  YOUR MACHINE (Docker)                                  │
│                                                         │
│  ┌─────────────────┐     ┌──────────────────────────┐  │
│  │  Next.js :7331  │────▶│  MongoDB :27017           │  │
│  │  (web + API +   │     │  (local mirror)           │  │
│  │   Socket.io)    │     └──────────────────────────┘  │
│  └────────┬────────┘                                   │
│           │ sync                                        │
└───────────┼─────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────┐
   │  MongoDB Atlas   │  ← cloud source of truth
   │  (free cluster)  │
   └──────┬───────────┘
          │
          ├── Chrome Extension (writes via localhost API)
          ├── Future Phone App (reads/writes Atlas directly)
          └── Future Web Deploy (Vercel → Atlas)
```

---

## Project Structure

```
moonlit-flamingo/
├── docker-compose.yml          ← `docker-compose up` starts everything
├── .env                        ← MONGODB_URI, ATLAS_URI, NEXTAUTH_SECRET
├── package.json                ← npm workspaces root
│
├── apps/web/                   ← Next.js 15 app
│   ├── Dockerfile
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── library/page.tsx    ← Clip grid
│   │   ├── article/[id]/page.tsx ← Reader + real-time highlights
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── clips/route.ts
│   │       ├── clips/[id]/route.ts
│   │       ├── clips/[id]/export/route.ts
│   │       └── highlights/route.ts
│   │           highlights/[id]/route.ts
│   ├── components/
│   │   ├── layout/    (AppShell, Sidebar)
│   │   ├── library/   (ClipCard, ClipGrid, SearchBar)
│   │   └── reader/    (ReaderView, HighlightLayer, HighlightTooltip)
│   ├── lib/
│   │   ├── mongodb.ts          ← Mongoose singleton (Atlas or local)
│   │   ├── models/
│   │   │   ├── Clip.ts         ← Mongoose schema
│   │   │   └── Highlight.ts    ← Mongoose schema
│   │   ├── socket.ts           ← Socket.io server setup
│   │   ├── readability.ts
│   │   ├── turndown.ts
│   │   └── anchor.ts
│   └── hooks/
│       ├── useClips.ts
│       └── useHighlights.ts    ← Socket.io client hook (real-time)
│
└── extension/
    ├── manifest.json
    └── src/
        ├── background/service-worker.ts
        ├── content/
        │   ├── index.ts
        │   ├── clipper.ts
        │   ├── highlighter.ts       ← selection toolbar
        │   ├── liveHighlights.ts    ← renders highlights ON the live page
        │   └── anchor.ts
        ├── popup/
        │   ├── index.html
        │   └── Popup.tsx
        └── shared/api.ts            ← fetch to localhost:7331
```

---

## Docker Setup

### `docker-compose.yml`
```yaml
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    environment:
      MONGO_INITDB_DATABASE: moonlit

  web:
    build: ./apps/web
    ports:
      - "7331:3000"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/moonlit
      - ATLAS_URI=${ATLAS_URI}          # optional cloud sync
      - NODE_ENV=production
    depends_on:
      - mongo

volumes:
  mongo_data:
```

### `apps/web/Dockerfile`
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### One command to run
```bash
docker-compose up --build
# Open http://localhost:7331
```

---

## MongoDB Models

### Clip
```typescript
const ClipSchema = new Schema({
  _id: String,                      // nanoid(10)
  url: { type: String, required: true, unique: true },
  title: String,
  author: String,
  siteName: String,
  excerpt: String,
  coverImageUrl: String,
  rawHtml: String,
  readableHtml: String,
  markdownContent: String,
  wordCount: Number,
  readingTimeMinutes: Number,
  status: { type: String, enum: ['unread','reading','done','archived'], default: 'unread' },
  tags: [String],
  clippedAt: { type: Date, default: Date.now },
  updatedAt: Date,
});
```

### Highlight
```typescript
const HighlightSchema = new Schema({
  _id: String,
  clipId: { type: String, ref: 'Clip', required: true },
  anchor: {
    containerXPath: String,
    startOffset: Number,
    endOffset: Number,
    textSnippet: String,
  },
  selectedText: String,
  color: { type: String, enum: ['yellow','green','blue','pink','purple'], default: 'yellow' },
  note: String,
  createdAt: { type: Date, default: Date.now },
});
```

---

## Real-Time Highlights (Socket.io)

Replaces the 2s polling from the original plan. Highlights appear instantly.

```
User highlights text on webpage
  → extension content script captures XPath anchor
  → service worker POSTs to localhost:7331/api/highlights
  → API saves to MongoDB
  → API emits socket event: highlight:created { clipId, highlight }
  → App's useHighlights hook receives event via Socket.io
  → HighlightLayer injects <mark> into reader DOM immediately
  → Also: extension's liveHighlights.ts is connected via socket
    → renders <mark> on the LIVE webpage too
```

### Socket events
| Event | Direction | Payload |
|---|---|---|
| `highlight:created` | server → clients | `{ clipId, highlight }` |
| `highlight:deleted` | server → clients | `{ clipId, highlightId }` |
| `clip:created` | server → clients | `{ clip }` |
| `join:clip` | client → server | `{ clipId }` — subscribe to a clip's room |

---

## Live Highlights on the Website

`extension/src/content/liveHighlights.ts` — when you're on a page you've clipped:

1. On page load: check `GET /api/clips?url=<current>` → get `clipId`
2. If found: fetch existing highlights + connect Socket.io
3. Render existing `<mark>` elements from saved anchors
4. On `highlight:created` event: inject new `<mark>` instantly

This means: highlight on page A in one tab → the highlight appears **on that same page** in another tab immediately.

---

## MongoDB Sync Strategy

Two connection strings, one env var controls which is active:

```typescript
// lib/mongodb.ts
const uri = process.env.ATLAS_URI || process.env.MONGODB_URI;
// ATLAS_URI = production cloud Atlas
// MONGODB_URI = local docker mongo (default)
```

For cloud sync:
- **Option A (simple):** Set `ATLAS_URI` → app writes directly to Atlas. Docker Mongo not used. Phone app also reads Atlas.
- **Option B (resilient):** Write to local MongoDB; a background job syncs to Atlas every 30s using `changeStream`. Survives offline use.

Start with Option A. It's one env var change.

---

## API Routes

All under `localhost:7331/api/` with CORS open for the extension.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Extension health check |
| POST | `/api/clips` | Save page → Readability + Turndown + emit `clip:created` |
| GET | `/api/clips` | List (`?q=`, `?status=`, `?tag=`) |
| GET | `/api/clips/[id]` | Full clip + highlights |
| PATCH | `/api/clips/[id]` | Update status/tags |
| DELETE | `/api/clips/[id]` | Delete clip + highlights |
| GET | `/api/clips/[id]/export` | Download AI markdown |
| POST | `/api/highlights` | Create → save + emit `highlight:created` |
| DELETE | `/api/highlights/[id]` | Delete → emit `highlight:deleted` |

---

## Markdown Export (AI Format)

```markdown
---
title: "The Future of Local-First Software"
url: https://inkandswitch.com/local-first/
author: Martin Kleppmann
clipped: 2026-05-13
tags: [research, distributed-systems]
---

[clean article body]

---
## My Highlights

> "We propose 'local-first software'..."
— *yellow* | Note: Compare with Stallman's SaaS essay
```

---

## Build Phases

### Phase 1 — Docker + App Foundation
- Monorepo + `docker-compose.yml`
- Next.js 15 Dockerfile
- Mongoose models (Clip, Highlight)
- `lib/mongodb.ts` singleton
- `POST /api/clips` with Readability + Turndown
- Library page + basic reader view

**Done when:** `docker-compose up` → open `localhost:7331` → `curl POST /api/clips` → article visible.

### Phase 2 — Real-time + Socket.io
- `lib/socket.ts` server setup in Next.js
- `useHighlights` Socket.io client hook
- Replace polling with socket events in `HighlightLayer`
- `highlight:created` / `highlight:deleted` events wired up

**Done when:** Open article in two browser tabs → create highlight in one → appears in other instantly.

### Phase 3 — Extension Clipper
- Extension scaffold (esbuild)
- Service worker + content script (clipper)
- Popup with health check + Clip button
- CORS on all API routes

**Done when:** Right-click → Clip → appears in `localhost:7331/library`.

### Phase 4 — Highlights (Extension + Live Pages)
- XPath anchor capture
- Selection toolbar (color swatches)
- `POST /api/highlights` from extension
- `liveHighlights.ts` — renders on live page + connects socket
- `HighlightLayer` in app reader view

**Done when:** Highlight on live page → visible on that page AND in app reader instantly.

### Phase 5 — Atlas Cloud Sync
- Set `ATLAS_URI` in `.env`
- Test writes going to Atlas
- Verify phone app (React Native) can read same data

**Done when:** Highlight on laptop → visible on phone via Atlas.

### Phase 6 — Polish + Export
- Markdown export download
- Search bar
- Tag editing
- Status cycling
- Highlights sidebar

---

## Dev Commands

```bash
# Docker (production-like)
docker-compose up --build
# → open http://localhost:7331

# Local dev (faster iteration)
npm run dev          # Next.js + esbuild watch
npm run dev:app      # Next.js only
npm run dev:ext      # extension only

# Load extension:
# chrome://extensions/ → Developer Mode → Load unpacked → extension/dist/
```

---

## Environment Variables

```bash
# .env
MONGODB_URI=mongodb://localhost:27017/moonlit   # local docker
ATLAS_URI=mongodb+srv://user:pass@cluster.mongodb.net/moonlit  # cloud (optional)
NEXTAUTH_SECRET=your-secret-here
NEXT_PUBLIC_SOCKET_URL=http://localhost:7331
```

---

## Critical Implementation Notes

1. **Socket.io + Next.js 15**: Socket.io needs a custom server (`server.ts`) — Next.js App Router doesn't expose the raw HTTP server. Use `createServer` from Node `http` + `next()` handler.

2. **`anchor.ts` must be identical** in `extension/src/content/anchor.ts` and `apps/web/lib/anchor.ts` — XPath capture and resolution must round-trip perfectly.

3. **CORS is the #1 failure point** — all API routes need `Access-Control-Allow-Origin: *`. Also add socket.io CORS config for the extension origin.

4. **MongoDB connection in Docker**: `MONGODB_URI=mongodb://mongo:27017/moonlit` — use the service name `mongo`, not `localhost`, inside Docker.

5. **`rawHtml` is stored** — extension sends full HTML, Readability runs server-side. Keeps extension fast and allows reprocessing.

6. **Atlas swap is one env var**: Set `ATLAS_URI` and the app writes to cloud. No code changes needed.

7. **Socket rooms by `clipId`**: clients call `join:clip` with the clipId they're viewing — server only pushes to relevant clients, not all connections.
