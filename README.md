# Git GUI

A professional Git GUI built with Electron, React, TypeScript, and TailwindCSS.

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Electron** (v41) | Desktop shell |
| **electron-vite** | Build tool for Electron |
| **electron-builder** | Packaging and distribution |
| **React** (v19) | UI framework |
| **Vite** (v5) | Bundler and dev server |
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

- Node.js (v18 or higher)
- pnpm

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

MIT