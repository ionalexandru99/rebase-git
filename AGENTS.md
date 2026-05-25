# Agent Instructions

## What This App Is

This is **Rebase**, a Git GUI built with **Electron + TypeScript**. It's a desktop-only application for managing Git repositories with a fast, native-feeling UI.

> Git work runs in a forked HTTP **sidecar**; the SolidJS renderer uses **TanStack Query** + native `fetch` (Zod contracts in `src/shared/`). Commit history streams over IPC.

## Core Principles

### 1. Lightweight and Performant

This app must feel fast. Users open repos, stage files, and commit hundreds of times per day. Every interaction should be snappy.

- **Avoid unnecessary abstractions.** Don't add layers that don't solve a real problem.
- **The main thread must never block on Git.** Git work runs in a forked `utilityProcess` sidecar exposing an HTTP server on loopback (`127.0.0.1:<random-port>`, bearer-token auth). The main process only manages window lifecycle, dialogs, the store, deep links, the updater, and the sidecar's spawn/health/kill — it does **not** call `simple-git`. The renderer reaches the sidecar via `sidecarFetch` (native `fetch` + Zod).
- **Keep bundle size small.** Don't pull in heavy dependencies unless they're essential.
- **Profile before optimizing, but don't write slow code.** Prefer fine-grained reactivity over broad re-renders. Virtualize unbounded lists.
- **Git operations are blocking by nature.** Keep the UI responsive with clear loading states. Don't freeze the renderer.
- **No comments unless absolutely necessary.** Default to writing none. Only add one when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader. If removing the comment wouldn't confuse a future reader, don't write it. Don't explain WHAT the code does — well-named identifiers do that. Don't reference the current task, fix, or callers ("used by X", "added for the Y flow", "handles the case from issue #123") — those belong in the PR description and rot as the codebase evolves.
- **One tab per repo is an enforced invariant.** `useTabs.requestOpenRepo` (`src/renderer/hooks/useTabs.ts:84`) blocks opening a second tab on a repo that's already open — the call routes the user to the existing tab and discards the new (empty) one. Treat "two tabs on the same repo" as unreachable; do not add refcount/sharing logic for that case. `repoPath` is effectively the per-tab identifier in main.
- **Each tab is its own world.** Tabs hold *different* repos and must not interfere. Every main-process resource that streams or mutates state must be keyed so a different-repo tab's IPC can't cancel or starve another's (e.g. `Map<\`${webContentsId}:${repoPath}\`, …>`, not `Map<webContentsId, …>`). Same-repo conflict is impossible by the invariant above, but cross-repo isolation is real and must be designed for.

### 2. Tests Are Always Required

Every code change that adds or modifies behavior must include tests. No exceptions.

We have 4 test layers. Use the right one for the change:

| Layer | When to Use | How to Run |
|-------|-------------|------------|
| **Renderer unit tests** | Solid components, hooks, UI state logic | `pnpm test:renderer` |
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


- `src/main/` — Electron main process. Window lifecycle, splash, dialogs, `electron-store`, deep links, updater, menu, and the sidecar's spawn/health/kill. **No Git logic.**
- `src/sidecar/` — forked `utilityProcess` running a Node HTTP server on loopback. Owns all `simple-git` work and the `Map<repoPath, SimpleGit>`.
- `src/preload/` — Safe `contextBridge` bridge. Exposes window/OS IPC (dialogs, store, zoom, deep links) plus the sidecar URL+token to the renderer.
- `src/shared/` — Zod schemas shared by sidecar, main IPC, and renderer (HTTP + IPC wire shapes).
- `src/renderer/` — SolidJS UI. Git reads/writes via TanStack Query + `sidecarFetch`; log stream and repo open/close stay imperative over IPC.

Keep this architecture clean. The renderer is Electron-native, not a general web app — but the sidecar boundary is HTTP, so domain logic stays browser-portable.

### 3. Exact Dependencies

All dependencies in `package.json` must use exact versions — **no `^` or `~` prefixes**. This is a security measure: we audit and approve every version that goes into the app, and we don't want `npm install` pulling in unreviewed updates.

- When adding a dependency, specify the exact version: `pnpm add package@1.2.3`
- When updating, explicitly review the changelog and bump the exact version in `package.json`
- Lockfiles (`pnpm-lock.yaml`) are required in the repo
- **Postinstall scripts are restricted** via `allowBuilds` in `pnpm-workspace.yaml` (pnpm 11+). Only explicitly allowed packages (e.g., `electron`) can run install scripts. All others are blocked.

## Tech Stack

- **Electron** 41.x with `electron-vite`
- **Zod** for shared contracts (`src/shared/schemas/`, `codec.ts`)
- **`@tanstack/solid-query`** for sidecar data (status, branches, mutations) with per-tab `queryKey` prefixes
- **`@tanstack/solid-virtual`** for unbounded lists (history, ref tree, status files)
- **SolidJS** (+ Kobalte) for the renderer
- **Tailwind CSS** 4.x
- **simple-git** for Git operations (inside the sidecar)
- **electron-store** for persistent settings
- **Biome** for linting and formatting
- **Vitest** + **jsdom** for renderer tests; **Playwright** for E2E
- **pnpm** as package manager (with `ignore-scripts=true` for security)

## Style

Biome enforces formatting and lint rules — run `pnpm check:fix` before committing.

- **Always use block statements** for `if`, `else`, `for`, `while`, and `do` — even for one-liners. Never write `if (x) return`; write `if (x) { return }`. Enforced by Biome `useBlockStatements`.
- Single quotes (JS), double quotes (JSX), no semicolons, 2-space indent, 100-column lines, `useImportType` as error.
- Default to **no comments** unless the WHY is non-obvious (same rule as Core Principles §1).
- Use descriptive variable names; avoid terse abbreviations except loop indices (`i`/`j`), event params (`e`), and `_` for unused bindings.
