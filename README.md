# Git GUI

A professional Git GUI built with Electron, React, TypeScript, and TailwindCSS.

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Electron** (v41) | Desktop shell |
| **electron-vite** | Build tool for Electron |
| **electron-builder** | Packaging and distribution |
| **React** (v19) | UI framework |
| **Vite** (v6) | Bundler and dev server |
| **TypeScript** (v5.8) | Type safety |
| **TailwindCSS** (v4) | Styling |
| **Biome** (v2.4) | Formatter and linter |
| **pnpm** | Package manager |
| **simple-git** | Git operations |
| **electron-store** | Local settings storage |
| **electron-updater** | Auto-updates |
| **electron-context-menu** | Right-click menus |
| **electron-window-state** | Window position/size persistence |

## Features

- Open multiple repositories in isolated tabs and quickly reopen recent or workspace repositories
- Browse, search, create, check out, rename, merge, and delete branches
- Create and delete tags; create, apply, pop, and drop stashes
- Stream and paginate virtualized commit history with topology graphs and branch visibility controls
- Inspect syntax-highlighted diffs and stage or unstage files and individual hunks
- Commit, amend, reword, and selectively remove files or hunks from the previous commit
- Fetch, pull, publish, push, and safely escalate force pushes with remote-loss previews
- Surface merge conflicts with persistent resolution guidance
- Persist window, tab, sidebar, and local-pane state with responsive compact layouts
- Run Git outside the main and renderer processes through an authenticated loopback sidecar
- Use context menus for file, commit, branch, tag, and stash actions

## Getting Started

### Prerequisites

- Node.js 24.15 or newer within major 24
- pnpm 11.2.2
- Git

The supported Node version is declared in `package.json` and matches the Node release bundled
with Electron, which is what the packaged app actually runs. CI verifies that version on Linux,
Windows, and macOS.

### macOS Setup

Install a supported Node.js version and pnpm, then install dependencies:

```bash
npm install --global pnpm@11.2.2
pnpm install
```

Run the app in development mode:

```bash
pnpm dev
```

Build production files:

```bash
pnpm build
```

Package a macOS app:

```bash
pnpm package:mac
```

If `pnpm dev` fails with `Error: Electron uninstall` or `Electron failed to install correctly`, Electron's platform binary was not unpacked correctly. Rebuild Electron and retry:

```bash
pnpm rebuild electron
pnpm dev
```

If that still fails, remove `node_modules` and reinstall:

```bash
rm -rf node_modules
pnpm install --force
pnpm rebuild electron
pnpm dev
```

### Linux Setup

Install system packages needed by Electron. Package names vary by distro, but these are the usual Ubuntu/Debian packages:

```bash
sudo apt update
sudo apt install -y \
  git \
  libgtk-3-0 \
  libnss3 \
  libxss1 \
  libasound2t64 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libgbm1
```

On older Ubuntu/Debian releases, the audio package may be named `libasound2` instead of `libasound2t64`.

Install a supported Node.js version and pnpm, then install dependencies:

```bash
npm install --global pnpm@11.2.2
pnpm install
```

Run the app in development mode:

```bash
pnpm dev
```

Build production files:

```bash
pnpm build
```

Package a Linux build:

```bash
pnpm package:linux
```

If Electron fails to launch after install, rebuild its downloaded binary:

```bash
pnpm rebuild electron
pnpm dev
```

### Installation

```bash
pnpm install
```

### Running the App

```bash
# Development mode (with hot reload)
pnpm dev

# Production build
pnpm build

# Preview production build
pnpm preview
```

### Code Quality

```bash
# Format all files
pnpm format

# Lint
pnpm lint

# Lint and auto-fix
pnpm lint:fix

# Run both format + lint checks
pnpm check

# Auto-fix all check issues
pnpm check:fix

# TypeScript type checking
pnpm typecheck
```

### Manual Playwright MCP Testing

Start the renderer-only manual test environment:

```bash
pnpm dev:playwright-mcp
```

Open `http://127.0.0.1:5173` with Playwright MCP. The page uses a deterministic in-memory
repository that supports browsing history and diffs, staging files, committing, refs, and stashes.
Reloading the page resets the fixture. To test first-run setup, open
`http://127.0.0.1:5173/?onboarding=1`.
To exercise the 2,000-commit page boundary and automatic continuation, open
`http://127.0.0.1:5173/?pagination=1`.
For persistent merge-conflict presentation, open `http://127.0.0.1:5173/?conflict=1`.

This mode tests the real renderer in Chromium. It does not launch Electron, access the filesystem,
or exercise the main-process and sidecar integration. It also omits React Strict Mode because the
in-memory boundary does not reproduce IPC scheduling; use renderer tests and `pnpm test:e2e` for
effect replay and Electron boundaries.

### Packaging

```bash
# Package for current platform
pnpm package

# Platform-specific
pnpm package:mac
pnpm package:win
pnpm package:linux
```

## Project Structure

```
git-gui/
├── src/
│   ├── main/                 # Window lifecycle, IPC proxy, settings, updater
│   ├── sidecar/              # HTTP service that owns Git operations
│   ├── preload/
│   │   └── index.ts          # Sandboxed IPC bridge
│   ├── shared/               # Effect Schema RPC and IPC contracts
│   └── renderer/
│       ├── index.html        # HTML entry
│       ├── main.tsx          # React entry
│       ├── App.tsx           # Root component
│       ├── index.css         # Tailwind entry
│       ├── components/       # History, status, diff, shell, and reusable UI
│       ├── hooks/            # Renderer interaction and layout hooks
│       └── stores/           # Query-backed per-repository state
├── electron.vite.config.ts   # electron-vite config
├── electron-builder.config.js # electron-builder config
├── biome.json                # Biome config
├── tsconfig.json             # TypeScript config (renderer)
├── tsconfig.node.json        # TypeScript config (main/node)
└── package.json
```

## Architecture

This app follows Electron's secure best practices:

- **Context Isolation** enabled
- **Sandbox** enabled for renderer
- **Preload script** exposes a typed API via `contextBridge`
- The main process handles lifecycle, dialogs, settings, and authenticated sidecar proxying
- A forked utility-process sidecar owns all Git operations
- The renderer uses typed IPC requests and has no Node.js or sidecar credentials
- Repository state and streaming resources remain isolated per tab

## License

Apache-2.0
