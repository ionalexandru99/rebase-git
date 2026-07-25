# Agent Instructions

Single source of truth for agents in this repo. `CLAUDE.md` imports this file — edit this one.

## What this is

**Rebase** — a desktop Git GUI: Electron 41 + React 19 + TypeScript + Tailwind 4, `pnpm` as package
manager. Git work runs in a forked HTTP sidecar so the main thread never blocks on Git.

## Commands

```bash
pnpm dev                  # electron-vite dev (hot reload, main + preload + renderer)
pnpm build                # electron-vite build → out/
pnpm preview              # run the built app
pnpm package[:mac|:win|:linux]   # electron-builder

pnpm typecheck            # tsc --noEmit
pnpm check                # biome format + lint check
pnpm check:fix            # auto-fix biome issues
pnpm hooks:install        # idempotent — points git at .githooks/ (also runs via `prepare` on install)

pnpm test:renderer        # vitest, happy-dom, src/renderer/**/*.test.{ts,tsx}
pnpm test:main            # vitest, node, src/main + src/shared unit tests
pnpm test:sidecar         # vitest, node, sidecar unit + real-git integration tests
pnpm test:smoke           # builds + launches the electron binary, watches stdout/stderr
pnpm test:e2e             # playwright against the real built app (e2e/*.spec.ts)
pnpm test                 # alias for test:renderer
pnpm test:ci              # renderer + main + sidecar + e2e

# Single test
pnpm vitest run src/renderer/components/__tests__/CommitPanel.test.tsx
pnpm vitest run --config vitest.main.config.ts src/main/__tests__/store.test.ts
pnpm vitest run --config vitest.sidecar.config.ts src/sidecar/__tests__/amend.integration.test.ts
pnpm playwright test e2e/app-launches.spec.ts
```

A `pre-push` hook in `.githooks/` runs `pnpm typecheck` and `pnpm check` and aborts the push on
failure. `pnpm install` wires it up via `prepare`; run `pnpm hooks:install` if you skipped scripts.

## Architecture

Five source roots, hard boundary between the processes:

- `src/main/` — Electron main. Window lifecycle, splash, dialogs, `electron-store`, updater, menu,
  the sidecar's spawn/health/kill, and proxying every Git IPC to the sidecar over loopback HTTP.
  **No Git logic.**
- `src/sidecar/` — forked `utilityProcess` running a Node HTTP server on loopback
  (`127.0.0.1:<random-port>`, bearer-token auth). Owns all `simple-git` work and the
  `Map<repoPath, SimpleGit>`.
- `src/preload/` — `contextBridge` bridge exposing `window.electronAPI`: window/OS IPC (dialogs,
  store, zoom) plus a `sidecarRequest` channel. Context isolation is on; the renderer has no Node
  access. The sidecar URL and bearer token stay inside main + sidecar and reach neither preload nor
  renderer.
- `src/shared/` — Effect Schema contracts shared by sidecar, main IPC, and renderer.
- `src/renderer/` — React 19 UI. Git reads/writes go through @tanstack/react-query + typed
  `callSidecarRpc` helpers → `window.electronAPI.sidecarRequest` → main → loopback HTTP → sidecar.
  `@tanstack/react-virtual` for unbounded lists. Log stream and repo open/close stay imperative over
  IPC. Vite alias `@` → `src/renderer`.

The renderer is Electron-native, not a general web app — but the sidecar boundary is HTTP, so domain
logic stays portable.

### Multi-tab, multi-repo model

N tabs, each holding a different repo. Every Git call carries a `repoPath`; there is no implicit
"current repo" in main or the sidecar. Main-process IPC that remains (open/close repo, log stream,
workspaces, settings) takes `repoPath` where relevant.

**At most one tab per repo is an enforced invariant** — `useTabs.openRepoInTab` routes an attempt to
open an already-open repo to the existing tab and discards the new one. So `repoPath` is effectively
the per-tab key in main, and "two tabs on the same repo" is unreachable: never add refcount/sharing
logic for it.

Two consequences for per-repo resources in main:

- `gitInstances` and `activeFetches` are keyed by `repoPath` — already per-tab by the invariant.
- Resources that can outlive a repo session (log streams cancelled per tab, multi-window state) are
  keyed by `${webContentsId}:${repoPath}` — see `activeLogStreams` in `src/main/ipc/log-stream.ts`.
  Never key by `webContentsId` alone: a different-repo IPC from the same window would cancel another
  tab's in-flight work and leave its loading state stuck.

Pick the narrower of the two that still routes correctly.

### Git responses

The sidecar uses Effect RPC and Effect Schema for tagged success/domain-error responses. The
renderer derives each response decoder from the shared RPC contract and parses it via `parseOrThrow`
in `src/shared/codec.ts` — don't assume legacy `{ success: boolean }` shapes for new code.

### Workspaces

A workspace is a parent folder containing one or more git repos. The store keeps `workspaces`,
`activeWorkspace`, and a **legacy** `workingDirectory` field. `migrateLegacyWorkingDirectory()` in
`src/main/store.ts` promotes the legacy field into `workspaces` on first read and runs from every
workspace getter/setter — it's idempotent. Prefer `getActiveWorkspace()` / `getWorkspaces()`; the
`getWorkingDirectory` / `setWorkingDirectory` aliases exist only for older call sites.

### Onboarding

`useOnboarding` gates the UI: until `onboardingComplete` is set in the store, `App.tsx` renders
`OnboardingScreen` instead of the tab UI. The `scan-for-repos` IPC walks a directory one level deep
and returns immediate child folders that are git repos.

### Preload path resolution

`electron-vite` may emit the preload as `.mjs`, `.js`, or `.cjs` depending on build mode.
`resolvePreload()` in `src/main/index.ts` probes for each — don't hardcode the extension.

## Core rules

### 1. Lightweight and performant

Users open repos, stage files, and commit hundreds of times per day; every interaction must feel
snappy.

- **The main thread never blocks on Git.** Git runs in the sidecar; main only proxies.
- **Avoid unnecessary abstractions** and heavy dependencies — keep the bundle small.
- Prefer fine-grained reactivity over broad re-renders. Virtualize unbounded lists.
- Git operations are blocking by nature: keep the UI responsive with clear loading states.

### 2. Tests are always required

Every change that adds or modifies behaviour ships with tests. No exceptions.

| Layer | When to use |
|-------|-------------|
| **Renderer** (`test:renderer`) | React components, hooks, UI state. happy-dom, `window.electronAPI` mocked. |
| **Main** (`test:main`) | Pure functions, store logic, data transformations. Plain Node, short timeout. |
| **Sidecar** (`test:sidecar`) | Sidecar logic and real-Git integration. Node, longer timeout. |
| **Smoke** (`test:smoke`) | Build sanity, startup, preload path resolution. Needs a build; only checks that startup printed no fatal errors — it doesn't drive the UI. |
| **E2E** (`test:e2e`) | Flows spanning main and renderer (IPC contracts, "open repo → see branches → commit"). Playwright against the real built binary. |

Renderer setup: `src/test/setup.ts` mocks the whole `window.electronAPI` surface with `vi.fn()`s
plus happy-dom polyfills for `matchMedia` and `ResizeObserver` (Radix/sonner/next-themes need them).
`vi.resetAllMocks()` runs in `beforeEach`, so set mock returns inside the test or its `beforeEach`,
never at module top level. `matchMedia` is a plain function rather than a `vi.fn()` precisely so
`resetAllMocks` doesn't strip it.

What **not** to unit-test: don't mock `BrowserWindow` or `ipcMain` (brittle, low value — E2E covers
IPC integration), and don't test Electron boilerplate like window creation, menus, or the updater
(smoke tests catch startup regressions).

### 3. Exact dependencies

All `package.json` dependencies use exact versions — **no `^` or `~`**. We audit every version that
goes into the app and don't want an install pulling in unreviewed updates.

- Add with an exact version: `pnpm add package@1.2.3`.
- When updating, review the changelog and bump the exact version explicitly.
- `pnpm-lock.yaml` is committed.
- **Postinstall scripts are restricted** via `allowBuilds` in `pnpm-workspace.yaml` (pnpm 11+). Only
  explicitly allowed packages (e.g. `electron`) run install scripts; everything else is blocked.

## Style

Biome enforces formatting and lint rules — run `pnpm check:fix` before committing.

- Single quotes (JS), double quotes (JSX), no semicolons, 2-space indent, 100-column lines,
  `useImportType` as error.
- **`useBlockStatements` as error**: always brace `if`/`else`/`for`/`while`/`do`, even one-liners.
  Never `if (x) return`; write `if (x) { return }`.
- shadcn components live in `src/renderer/components/ui/` (style `new-york`, base color `neutral`,
  CSS vars enabled).
- **Descriptive names.** No terse abbreviations like `r`, `g`, `c`, `ps`, `vh` — write `result`,
  `git`, `commit`, `parents`, `viewportHeight`. Acceptable short names: `i`/`j` for loop indices,
  `e` for event params, `_` for an unused binding, and a one-letter name inside a tiny lambda where
  the type makes it obvious (`items.map((x) => x.id)`).
- **Default to no comments.** Only write one when the WHY is non-obvious: a hidden constraint, a
  subtle invariant, a workaround for a specific bug, behaviour that would surprise a reader. If
  removing it wouldn't confuse a future reader, don't write it. Never explain WHAT the code does —
  well-named identifiers do that — and never reference the current task, fix, PR, or callers; that
  rots. Same for docstrings: one short line, never multi-paragraph.

## Pull requests

Each PR is **exactly one commit**, merged into `main` with **rebase + fast-forward** (no squash, no
merge commit), so that commit lands on `main` verbatim as one self-contained, revertable unit. Fold
follow-up work back in with `git commit --amend` or interactive rebase (and force-push) before
merging; never stack fixup commits on a PR.

Commit messages follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):
a `type(scope): summary` subject — `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`,
`build`, `ci`, `style`, `revert` — with an optional body, and `!` after the type/scope (or a
`BREAKING CHANGE:` footer) for breaking changes.

## Agent conventions

- Issues and external PRs are tracked in this repo's GitHub Issues via the `gh` CLI; `/triage`
  treats external pull requests as a request surface alongside issues.
- Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- Domain docs are single-context: one `CONTEXT.md` at the repo root.
