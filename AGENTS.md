# Agent Instructions

## What This App Is

This is **Rebase**, a Git GUI built with **Electron + React + TypeScript**. It's a desktop-only application for managing Git repositories with a fast, native-feeling UI.

## Core Principles

### 1. Lightweight and Performant

This app must feel fast. Users open repos, stage files, and commit hundreds of times per day. Every interaction should be snappy.

- **Avoid unnecessary abstractions.** Don't add layers that don't solve a real problem.
- **Prefer direct calls over IPC round-trips.** The main process owns Git logic via `simple-git`. Don't add HTTP servers, local APIs, or other indirections.
- **Keep bundle size small.** Don't pull in heavy dependencies unless they're essential.
- **Profile before optimizing, but don't write slow code.** Avoid unnecessary re-renders in React. Use `useMemo` and `useCallback` where it matters, but not everywhere.
- **Git operations are blocking by nature.** Keep the UI responsive with clear loading states. Don't freeze the renderer.
- **No comments unless absolutely necessary.** Default to writing none. Only add one when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader. If removing the comment wouldn't confuse a future reader, don't write it. Don't explain WHAT the code does — well-named identifiers do that. Don't reference the current task, fix, or callers ("used by X", "added for the Y flow", "handles the case from issue #123") — those belong in the PR description and rot as the codebase evolves.
- **One tab per repo is an enforced invariant.** `useTabs.requestOpenRepo` (`src/renderer/hooks/useTabs.ts:84`) blocks opening a second tab on a repo that's already open — the call routes the user to the existing tab and discards the new (empty) one. Treat "two tabs on the same repo" as unreachable; do not add refcount/sharing logic for that case. `repoPath` is effectively the per-tab identifier in main.
- **Each tab is its own world.** Tabs hold *different* repos and must not interfere. Every main-process resource that streams or mutates state must be keyed so a different-repo tab's IPC can't cancel or starve another's (e.g. `Map<\`${webContentsId}:${repoPath}\`, …>`, not `Map<webContentsId, …>`). Same-repo conflict is impossible by the invariant above, but cross-repo isolation is real and must be designed for.

### 2. Tests Are Always Required

Every code change that adds or modifies behavior must include tests. No exceptions.

We have 4 test layers. Use the right one for the change:

| Layer | When to Use | How to Run |
|-------|-------------|------------|
| **Renderer unit tests** | React components, hooks, UI state logic | `pnpm test:renderer` |
| **Main process unit tests** | Pure functions, store logic, data transformations | `pnpm test:main` |
| **Smoke tests** | Build sanity, startup checks, preload path resolution | `pnpm test:smoke` |
| **E2E tests** | Critical user flows, IPC contracts, full app integration | `pnpm test:e2e` |

- **Renderer tests** run in jsdom with `window.electronAPI` mocked. Fast feedback for UI code.
- **Main tests** run in Node.js. Only test pure logic that doesn't touch `BrowserWindow`, `dialog`, or other Electron APIs.
- **Smoke tests** build the app and launch the binary, checking stdout/stderr for fatal errors. Cheap and catches real build/packaging bugs.
- **E2E tests** launch the real built Electron binary via Playwright. Use for flows that span main and renderer (e.g., "open repo → see branches → commit").

### What NOT to test in unit tests

- Don't mock `BrowserWindow` or `ipcMain` in unit tests. That's brittle and low value. Let E2E cover IPC integration.
- Don't test Electron boilerplate (window creation, menu bar, updater). Let smoke tests catch startup failures.

## Architecture

- `src/main/` — Node.js/Electron main process. Git operations via `simple-git`, window management, IPC handlers.
- `src/preload/` — Safe bridge between main and renderer. Exposes typed API via `contextBridge`.
- `src/renderer/` — React UI. Only runs inside Electron. Talks to main via `window.electronAPI`.

Keep this architecture clean. The renderer is Electron-native, not a web app. Don't try to make it run in a browser.

### 3. Exact Dependencies

All dependencies in `package.json` must use exact versions — **no `^` or `~` prefixes**. This is a security measure: we audit and approve every version that goes into the app, and we don't want `npm install` pulling in unreviewed updates.

- When adding a dependency, specify the exact version: `pnpm add package@1.2.3`
- When updating, explicitly review the changelog and bump the exact version in `package.json`
- Lockfiles (`pnpm-lock.yaml`) are required in the repo
- **Postinstall scripts are restricted** via `pnpm.onlyBuiltDependencies` in `package.json`. Only explicitly listed packages (e.g., `electron`) can run install scripts. All others are blocked.

## Tech Stack

- **Electron** 41.x with `electron-vite`
- **React** 19 with TypeScript
- **Tailwind CSS** 4.x with shadcn/ui components
- **simple-git** for Git operations
- **electron-store** for persistent settings
- **Biome** for linting and formatting
- **Vitest** + **@testing-library/react** + **jsdom** for renderer tests
- **Playwright** for E2E tests
- **pnpm** as package manager (with `ignore-scripts=true` for security)
