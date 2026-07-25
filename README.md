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

- Open and browse git repositories
- View working directory status (modified, staged, untracked files)
- Stage and unstage files
- Commit changes
- View commit history
- Recent repositories
- Window state persistence
- Auto-updater (via GitHub releases)
- Right-click context menus

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
│   ├── main/
│   │   ├── index.ts          # Main process entry
│   │   ├── store.ts          # electron-store settings
│   │   ├── updater.ts        # Auto-updater setup
│   │   └── menu.ts           # Context menu setup
│   ├── preload/
│   │   └── index.ts          # Preload script (IPC bridge)
│   └── renderer/
│       ├── index.html        # HTML entry
│       ├── main.tsx          # React entry
│       ├── App.tsx           # Root component
│       ├── index.css         # Tailwind entry
│       ├── types.ts          # Shared types
│       ├── components/
│       │   ├── Header.tsx
│       │   ├── StatusPanel.tsx
│       │   ├── CommitPanel.tsx
│       │   └── HistoryPanel.tsx
│       └── hooks/
│           └── useGit.ts
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
- Main process handles all system/git operations
- Renderer is a standard React app with no Node.js access

## Next Steps / Ideas

- Show diffs for modified files
- Branch creation, switching, and management
- Push/pull/fetch remote operations
- Merge conflict resolution
- Stash management
- Tag management
- File tree browser
- Settings panel (theme, git config)
- Keyboard shortcuts
- Custom themes

## License

Apache-2.0
