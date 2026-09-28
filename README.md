# Percy Local Manager

A lightweight **Visual Testing Companion** that abstracts Percy server management for Manual QA Engineers. Start the server, use the Chrome extension to capture snapshots, and finalize the build — no terminal knowledge required.

```
Chrome Extension → HTTP (localhost:4321) → Go Backend → Percy CLI → Percy Cloud
```

---

## Overview

Percy Local Manager consists of three components that work together:

| Component | Technology | Role |
|---|---|---|
| **Go Backend** | Go | Central controller — manages Percy CLI, exposes local HTTP API, queues snapshots |
| **Chrome Extension** | React + TypeScript + Vite (MV3) | Captures DOM, URL, and viewport; sends snapshots to the backend |

---

## User Workflow

1. Start the Go backend server (distributable or `go run`)
2. Install the Chrome extension
3. Navigate to any page in Chrome and click **Capture** in the extension popup
4. Snapshots are queued in the backend
5. Click **Finalize Build** in the extension to upload all snapshots to Percy

---

## Repository Structure

```
Percy_chrome_ext/
├── go-backend/                  # Go HTTP server + Percy process manager
│   ├── cmd/server/main.go       # Entry point — starts server on :4321
│   └── internal/
│       ├── api/                 # Router + HTTP handlers
│       ├── app/                 # Application wiring
│       ├── library/             # Percy snapshot library (cache, client, service)
│       ├── middleware/          # CORS, logger, recovery, chain
│       ├── percy/               # Percy CLI binary management + controller
│       ├── service/             # Build and snapshot business logic
│       └── snapshot/            # In-memory snapshot store
│
├── percy-local-manager-extension/   # Chrome Extension source (build from here)
│   ├── src/
│   │   ├── popup/               # Extension popup UI
│   │   ├── components/          # React UI components
│   │   ├── hooks/               # Connection status, queue, capture, finalize hooks
│   │   ├── services/            # DOM capture + backend API client
│   │   ├── types/               # Shared TypeScript types
│   │   └── utils/               # Constants (backend URL, endpoints)
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
| `POST` | `/build/finalize` | Upload all queued snapshots to Percy — returns `{ buildId, buildUrl }` |

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
+---------------------+
| Chrome Extension    |
+----------+----------+
           |
     HTTP localhost:4321
           |
+----------v----------+
|    Go Backend       |
|---------------------|
| Percy Controller    |  ← spawns & monitors percy-cli
| Snapshot Store      |  ← in-memory queue
| Build Service       |  ← finalizes Percy build
| Library Service     |  ← snapshot library cache
| HTTP API            |  ← serves Chrome extension
+----------+----------+
           |
     spawn process
           |
    percy-cli exec:start
           |
     Percy Cloud
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Go (net/http) |
| Chrome Extension | React 18, TypeScript, Vite, Manifest V3 |
| Communication | HTTP over localhost |

---

## Setup Guides

| Platform | Guide |
|---|---|
| macOS | [`Distributables/percy-mac/Instructions.md`](Distributables/percy-mac/Instructions.md) |
| Linux | [`Distributables/percy-linux/Instruction.md`](Distributables/percy-linux/Instruction.md) |
| Windows | [`Distributables/percy-windows/Instructions.md`](Distributables/percy-windows/Instructions.md) |
