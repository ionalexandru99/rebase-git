# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Rebase** — a desktop Git GUI built with Electron 41 + React 19 + TypeScript + Tailwind 4 (shadcn/ui new-york style). `simple-git` drives all Git operations from the main process. `pnpm` is the package manager.

`AGENTS.md` contains the binding rules: lightweight & performant, tests required for every behaviour change, exact dependency versions (no `^`/`~`), restricted postinstall scripts (`pnpm.onlyBuiltDependencies`).

## Commands

```bash
pnpm dev                  # electron-vite dev (hot reload, main + preload + renderer)
pnpm build                # electron-vite build → out/
pnpm preview              # run the built app
pnpm package[:mac|:win|:linux]   # electron-builder

pnpm typecheck            # tsc --noEmit
pnpm check                # biome format + lint check
pnpm check:fix            # auto-fix biome issues

# Four test layers — pick the one that matches the change:
pnpm test:renderer        # vitest, jsdom, src/renderer/**/*.test.{ts,tsx}
pnpm test:main            # vitest, node, src/main/**/*.test.{ts,tsx}
pnpm test:smoke           # builds + launches the electron binary, watches stdout/stderr
pnpm test:e2e             # playwright against the real built app (e2e/*.spec.ts)
pnpm test                 # alias for test:renderer
pnpm test:ci              # renderer + main + e2e

# Single test
pnpm vitest run src/renderer/components/CommitPanel.test.tsx
pnpm vitest run --config vitest.main.config.ts src/main/store.test.ts
pnpm playwright test e2e/app-launches.spec.ts
```

Smoke tests require a build first; they execute `out/main/index.js` and only check that startup didn't print fatal errors — they don't drive the UI. E2E launches the real Electron binary via Playwright, so use it for flows that span main and renderer (IPC contracts, full integration).

## Architecture

Three processes, hard boundary between them:

- `src/main/` — Node/Electron. Owns Git logic, IPC handlers, `electron-store` persistence, window state, updater, context menu.
- `src/preload/` — single `index.ts` that exposes a typed `window.electronAPI` via `contextBridge`. Context isolation is enabled; the renderer has no Node access.
- `src/renderer/` — React. Talks to main exclusively through `window.electronAPI`. Vite alias `@` → `src/renderer`.

### Multi-tab, multi-repo model

The renderer supports N tabs, each independently holding a different repo. To match this, `src/main/index.ts` keeps a `Map<repoPath, SimpleGit>` and every IPC handler takes a `repoPath` argument to route to the right instance — there is no implicit "current repo" on the main side. When adding a new git operation, follow the same pattern: handler signature `(_, repoPath, ...args)`, look up via `gitInstances.get(repoPath)`, return `{ success: false, error }` if missing.

### IPC serialization

`simple-git` returns class instances (`StatusResult`, `LogResult`, `BranchSummary`) with getters that **cannot** be structured-cloned across the IPC bridge. The main process has `serializeStatus` / `serializeLog` / `serializeBranches` helpers that convert these to plain JSON-safe shapes matching `src/renderer/types.ts`. Any new git result that crosses IPC must be serialized the same way — don't return raw `simple-git` objects.

### Workspaces

A "workspace" is a parent folder that contains one or more git repos. The store keeps `workspaces: string[]`, `activeWorkspace`, and a **legacy** `workingDirectory` field. `migrateLegacyWorkingDirectory()` in `src/main/store.ts` promotes the legacy field into `workspaces` on first read and is called from every workspace getter/setter — it's idempotent. New code should prefer `getActiveWorkspace()` / `getWorkspaces()`; the `getWorkingDirectory` / `setWorkingDirectory` aliases exist only so older code paths keep working.

### Onboarding

`useOnboarding` (renderer) gates the UI: until `onboardingComplete` is set in the store, `App.tsx` renders `OnboardingScreen` instead of the tab UI. `scan-for-repos` IPC walks a directory one level deep and returns immediate child folders that are git repos.

### Preload path resolution

`electron-vite` may emit the preload as `.mjs`, `.js`, or `.cjs` depending on build mode. `resolvePreload()` in `src/main/index.ts` probes for each — don't hardcode the extension.

## Renderer test setup

`src/test/setup.ts` (loaded by `vitest.config.ts`) mocks the entire `window.electronAPI` surface with `vi.fn()`s, plus jsdom polyfills for `matchMedia` and `ResizeObserver` (Radix/sonner/next-themes need them). `vi.resetAllMocks()` runs in `beforeEach`, so tests must set up their `electronAPI` mock returns inside the test (or `beforeEach`), not at module top level. `matchMedia` is intentionally defined as a plain function rather than a `vi.fn()` so `resetAllMocks` doesn't strip its implementation.

Main-process tests run in plain Node and must only cover pure logic (store, serializers, etc.) — don't mock `BrowserWindow` / `ipcMain`; let E2E cover IPC integration. Don't unit-test Electron boilerplate (window creation, menus, updater) — smoke tests catch startup regressions.

## Style

Biome enforces: single quotes (JS), double quotes (JSX), no semicolons, 2-space indent, 100-col lines, `useImportType` as error. Run `pnpm check:fix` before committing. shadcn components live in `src/renderer/components/ui/` (style: `new-york`, base color `neutral`, CSS vars enabled).
