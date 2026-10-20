# Percy Local Manager

A lightweight **Visual Testing Companion** that abstracts Percy server management for Manual QA Engineers. Start the server, use the Chrome extension to capture snapshots or record multi-step workflows, and finalize the build — no terminal knowledge required.

```
Chrome Extension → HTTP (localhost:4321) → Go Backend → Percy CLI / Playwright → Percy Cloud
```

---

## Overview

Percy Local Manager consists of three components that work together:

| Component | Technology | Role |
|---|---|---|
| **Go Backend** | Go | Central controller — manages Percy CLI, exposes local HTTP API, queues snapshots, stores and replays workflows |
| **Chrome Extension** | React + TypeScript + Vite (MV3) | Captures DOM snapshots; records multi-step workflows; replays them via Playwright |

---

## User Workflow

### Manual Snapshot Capture

1. Start the Go backend server (distributable or `go run`)
2. Install the Chrome extension
3. Navigate to any page in Chrome and click **Capture** in the extension popup
4. Snapshots are queued in the backend
5. Click **Finalize Build** in the extension to upload all snapshots to Percy

### Workflow Recorder (multi-step)

1. Start the Go backend server
2. Open the extension popup and click **Record**
3. Interact with the page — clicks, form fills, selects, and scrolls are captured automatically
4. Click **Capture Snapshot** in the floating panel to mark Percy checkpoints
5. Click **Stop**, review the recorded steps, then **Save** the workflow
6. Click **Replay** on any saved workflow — the backend drives Playwright headlessly, takes Percy snapshots at each checkpoint, and finalizes the build

### Branch and Target Branch

Every build is created on a Percy **branch** and can optionally compare against a **target branch**. Both are shown above the **Finalize Build** button and the workflow **Replay / Create Build** button, with a **Default** / **Changed** badge. Your values are saved and reused for the next build; **Reset to default** restores them.

| Setting | Percy variable | Default | What it does |
|---|---|---|---|
| Branch | `PERCY_BRANCH` | `percy-local-manager` | The branch the build is created on |
| Target branch | `PERCY_TARGET_BRANCH` | empty | The branch whose latest build is the baseline. Empty = Percy's normal base-build selection |

The commit id is not configurable here; Percy derives it from git.

Values must not contain spaces or control characters and are limited to 255 characters.

### Compare Two URLs (e.g. staging vs production)

Percy picks a baseline by branch, so to compare two URLs you create one build per URL:

1. Capture or record snapshots against **production**. Use snapshot names that do **not** contain the URL, otherwise the two builds will not match up.
2. Set **Branch** to `production`, leave **Target branch** empty, and finalize/replay. Wait until this build has finished processing in Percy.
3. Run the same snapshots against **staging**.
4. Set **Branch** to `staging` and **Target branch** to `production`, then finalize/replay.

The staging build uses the latest `production` build as its baseline, so Percy shows only the differences between the two URLs.

---

## Repository Structure

```
Percy_chrome_ext/
├── go-backend/                  # Go HTTP server + Percy process manager
│   ├── cmd/server/main.go       # Entry point — starts server on :4321
│   └── internal/
│       ├── api/                 # Router + HTTP handlers (snapshots, build, workflows, runs)
│       ├── app/                 # Application wiring
│       ├── library/             # Percy snapshot library (cache, client, service)
│       ├── middleware/          # CORS, logger, recovery, chain
│       ├── percy/               # Percy CLI binary management + controller
│       ├── runs/                # Workflow run lifecycle (service, store, pump, adapters)
│       ├── runtime/             # Playwright installer + embedded runner JS
│       ├── service/             # Build and snapshot business logic
│       ├── snapshot/            # In-memory snapshot store
│       └── workflow/            # Workflow model, JSON store, validator
│
├── percy-local-manager-extension/   # Chrome Extension source (build from here)
│   ├── src/
│   │   ├── background/          # Service worker — owns recording state (recorder.ts)
│   │   ├── content/             # Injected page scripts — event capture (recorder.ts) + floating widget
│   │   ├── popup/               # Extension popup UI
│   │   ├── components/          # React UI components (WorkflowPanel, RecordedSteps, RunProgress…)
│   │   ├── hooks/               # useRecorder, useWorkflows, useRun, finalize, capture hooks
│   │   ├── services/            # DOM capture + backend API client + workflowApi
│   │   ├── types/               # Shared TypeScript types (workflow.ts, build.ts)
│   │   └── utils/               # Constants, recorderCore (pure locator helpers)
│   ├── public/manifest.json     # Chrome Manifest V3
│   └── package.json
│
├── Distributables/              # Pre-built binaries ready for distribution
│   ├── percy-mac/               # macOS (Intel + Apple Silicon)
│   ├── percy-linux/             # Linux (x86_64)
│   ├── percy-windows/           # Windows 10+
│   └── percy-local-manager-extension/   # Built extension (load unpacked)
│
└── build-distributables.sh      # Script to build all platform distributables
```

---

## Quick Start (Distributables)

Pre-built binaries are available in `Distributables/` — no Go or build tools required.

### macOS

```bash
cd Distributables/percy-mac

# One-time setup
chmod +x server server-arm64 server.sh
xattr -d com.apple.quarantine server
xattr -d com.apple.quarantine server-arm64

# Start
./server.sh start
```

Supports both Intel (`x86_64`) and Apple Silicon (`arm64`) — the script auto-detects.

### Linux

```bash
cd Distributables/percy-linux

# One-time setup
chmod +x server server.sh

# Start
./server.sh start
```

### Windows

```cmd
cd Distributables\percy-windows
server.bat start
```

> If Windows SmartScreen warns about the executable: click **More info → Run anyway**.

### Server Commands (macOS / Linux)

| Command | Description |
|---|---|
| `./server.sh start` | Start the server |
| `./server.sh stop` | Stop the server |
| `./server.sh restart` | Restart the server |
| `./server.sh status` | Check server status |
| `./server.sh logs` | View live server logs |

### Server Commands (Windows)

| Command | Description |
|---|---|
| `server.bat start` | Start the server |
| `server.bat stop` | Stop the server |
| `server.bat restart` | Restart the server |
| `server.bat status` | Check server status |

---

## Chrome Extension Setup

### Load the pre-built extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `Distributables/percy-local-manager-extension/`

### Build from source

```bash
cd percy-local-manager-extension
npm install
npm run build
```

Then load the generated `dist/` folder as an unpacked extension.

---

## Go Backend — Build from Source

**Prerequisites:** Go 1.21+

```bash
cd go-backend
go build -o server ./cmd/server
./server
```

The server starts on `http://localhost:4321`.

---

## Local API Reference

Base URL: `http://localhost:4321`

### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/status` | Percy process status |

### Snapshots

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/snapshots` | Capture a snapshot — `{ name, url, dom, viewportWidth, viewportHeight }` |
| `GET` | `/snapshots` | List queued snapshots |
| `PATCH` | `/snapshots/:id` | Update a queued snapshot |
| `DELETE` | `/snapshots/:id` | Delete a single snapshot |
| `DELETE` | `/snapshots` | Clear all queued snapshots |

### Build

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/build/finalize` | Upload all queued snapshots to Percy — body `{ token, branch?, targetBranch? }` (both optional; empty = defaults) |
| `GET` | `/build/finalize/stream` | SSE stream of build progress — events: `progress`, `done`, `error` |

### Workflows

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/workflows` | Save a recorded workflow — `{ name, startUrl, steps, settings }` |
| `GET` | `/workflows` | List all saved workflows |
| `GET` | `/workflows/:id` | Get a single workflow |
| `DELETE` | `/workflows/:id` | Delete a workflow |

### Runs (Workflow Replay)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workflows/{id}/runs` | Start a workflow replay — body `{ token, secrets?, branch?, targetBranch? }` (branch fields optional; empty = defaults) |
| `GET` | `/runs/:id` | Get run status and progress |
| `GET` | `/runs/:id/stream` | SSE stream of run log lines |
| `DELETE` | `/runs/:id` | Cancel a running workflow |

### Library

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/library/token` | Set Percy read token and load the snapshot library |
| `GET` | `/library/status` | Library connection status and snapshot count |
| `GET` | `/library/all` | Return all cached library snapshots |
| `GET` | `/library/search` | Search library snapshots by name |

---

## Architecture

```
+-----------------------------------------------+
| Chrome Extension                              |
|-----------------------------------------------|
| Popup UI (React)                              |
| Background Service Worker                     |  ← owns recording state (MV3)
| Content Script (injected per page)            |  ← captures clicks/fills/scrolls
+------------------------+----------------------+
                         |
                   HTTP localhost:4321
                         |
+------------------------v----------------------+
|    Go Backend                                 |
|-----------------------------------------------|
| Percy Controller    ← spawns percy-cli        |
| Snapshot Store      ← in-memory queue         |
| Build Service       ← finalizes build (SSE)   |
| Workflow Store      ← persists workflows JSON  |
| Runs Service        ← drives Playwright replay |
| Runtime             ← installs Playwright      |
| Library Service     ← snapshot library cache   |
| HTTP API            ← serves Chrome extension  |
+----------+--------------------+----------------+
           |                    |
     percy-cli exec:start    Playwright (headless)
           |                    |
     Percy Cloud         Percy snapshots at checkpoints
```

---

## Recorder — How It Works

The recorder captures a multi-step user journey in the browser and replays it headlessly to take Percy snapshots at consistent checkpoints.

### Recording (Extension)

1. **User clicks Record** in the popup → popup sends `rec:start` to the background service worker.
2. **Background worker** (`src/background/recorder.ts`) queries the active tab, injects `content.js` if needed, measures the viewport, and persists `RecordingState` to `chrome.storage.session` (survives popup close).
3. **Content script** (`src/content/recorder.ts`) attaches `click`, `change`, `input`, and `scroll` listeners. Each event is converted to a typed `WorkflowStep` and forwarded to the background via `rec:event`.
4. **Locator strategy** (`src/utils/recorderCore.ts`): prefers `data-testid` → `role+name` → stable CSS (`id`/`name` attribute) → visible text → structural path. Framework-generated IDs (React, Radix, MUI…) are filtered out. Sensitive fields store a `valueRef` instead of the literal value.
5. **Deduplication**: consecutive fills on the same field collapse to the latest value; consecutive scrolls collapse to the final position.
6. **Snapshot checkpoints**: clicking **Capture Snapshot** in the floating widget sends `rec:snapshot` → background appends a `snapshot` step with a unique `checkpointId`.
7. **Full-page navigations** are captured via `chrome.webNavigation.onCommitted`.
8. **Pause/Resume**: pausing stops capture without discarding steps; resuming adds a `navigate` step if the URL changed while paused.
9. **Save**: background validates (≥1 snapshot, all interactive steps have a locator), calls `POST /workflows`, and clears session state.

### Replay (Backend)

1. Extension sends `POST /runs` with `{ workflowId, token }`.
2. **Runs service** (`go-backend/internal/runs/service.go`) starts Percy CLI, then launches the embedded Node runner via Playwright.
3. **Runner JS** (`go-backend/internal/runtime/runnerjs/src/`) executes each step using Playwright's `page` API and calls `percy.snapshot()` at each `snapshot` step.
4. **Progress** is streamed to the extension via SSE (`GET /runs/:id/stream`).
5. The build is finalized automatically when all steps complete.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Go (net/http) |
| Chrome Extension | React 18, TypeScript, Vite, Manifest V3 |
| Replay Engine | Node.js + Playwright (installed at runtime by the backend) |
| Communication | HTTP + SSE over localhost |

---

## Setup Guides

| Platform | Guide |
|---|---|
| macOS | [`Distributables/percy-mac/Instructions.md`](Distributables/percy-mac/Instructions.md) |
| Linux | [`Distributables/percy-linux/Instruction.md`](Distributables/percy-linux/Instruction.md) |
| Windows | [`Distributables/percy-windows/Instructions.md`](Distributables/percy-windows/Instructions.md) |
