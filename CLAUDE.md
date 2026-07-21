# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Rebase** — a desktop Git GUI built with Electron 41 + TypeScript + Tailwind 4. `pnpm` is the package manager.

> Git work runs in a forked HTTP **sidecar** (main thread never blocks). The **React 19** renderer uses **@tanstack/react-query** + `@tanstack/react-virtual`, and reaches the sidecar through typed `callSidecarRpc` helpers over IPC (Effect Schema contracts in `src/shared/`). Commit history streams over IPC. See **`AGENTS.md`** for binding rules.

`AGENTS.md` contains the binding rules: main thread never blocks on Git, tests required for every behaviour change, exact dependency versions (no `^`/`~`), restricted postinstall scripts (`allowBuilds` in `pnpm-workspace.yaml`).

## Commands

```bash
pnpm dev                  # electron-vite dev (hot reload, main + preload + renderer)
pnpm build                # electron-vite build → out/
pnpm preview              # run the built app
pnpm package[:mac|:win|:linux]   # electron-builder

pnpm typecheck            # tsc --noEmit
pnpm check                # biome format + lint check
pnpm check:fix            # auto-fix biome issues
pnpm hooks:install        # idempotent — points git at .githooks/ (also runs via `prepare` on `pnpm install`)

# Test layers — pick the one that matches the change:
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

Smoke tests require a build first; they execute `out/main/index.js` and only check that startup didn't print fatal errors — they don't drive the UI. E2E launches the real Electron binary via Playwright, so use it for flows that span main and renderer (IPC contracts, full integration).

### Git hooks

A `pre-push` hook in `.githooks/pre-push` runs `pnpm typecheck` and `pnpm check` and aborts the push on any failure. `pnpm install` auto-runs `prepare`, which calls `git config core.hooksPath .githooks`, so a fresh clone is wired up after the first install. Run `pnpm hooks:install` manually if you skipped install scripts.

## Pull requests

Each PR is **exactly one commit**. PRs merge into `main` with **rebase + fast-forward** (no squash, no merge commit), so that single commit lands on `main` verbatim — one self-contained, individually revertable unit of history per merge. Fold any follow-up work back into the one commit with `git commit --amend` / interactive rebase (and force-push) before merging; never stack fixup commits on a PR.

The commit message must follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): a `type(scope): summary` subject — `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `style`, `revert` — with an optional body, and `!` after the type/scope (or a `BREAKING CHANGE:` footer) for breaking changes.

## Architecture

Four processes, hard boundary between them:

- `src/main/` — Node/Electron. Owns window lifecycle, dialogs, `electron-store` persistence, updater/menu, sidecar spawn/health/kill, and proxies every Git IPC to the sidecar over loopback HTTP. **No Git logic.**
- `src/sidecar/` — forked `utilityProcess` HTTP server on loopback (`127.0.0.1:<random-port>`, bearer-token auth); owns all `simple-git` work.
- `src/preload/` — typed `window.electronAPI` bridge for OS/window concerns plus a `sidecarRequest` IPC channel. Context isolation is enabled; the renderer has no Node access. The sidecar URL and bearer token stay inside main + sidecar and never reach the renderer or preload.
- `src/renderer/` — React 19 UI; @tanstack/react-query + typed `callSidecarRpc` helpers for Git ops; @tanstack/react-virtual for long lists. The RPC helper calls `window.electronAPI.sidecarRequest`, which IPCs to main, which forwards over loopback HTTP to the sidecar. Vite alias `@` → `src/renderer`.

Before changing architecture, read **`AGENTS.md`** (tests, exact dependency versions, restricted postinstall scripts through `allowBuilds`).

### Multi-tab, multi-repo model

The renderer supports N tabs, each independently holding a different repo. Git operations reach the sidecar with a `repoPath` on every call — there is no implicit "current repo" on the main or sidecar side. Main-process IPC that remains (open/close repo, log stream, workspaces, settings) still takes `repoPath` where relevant.

### Git responses

The sidecar uses Effect RPC and Effect Schema for tagged success/domain-error responses. The renderer derives each response decoder from the shared RPC contract and parses it via `parseOrThrow` in `src/shared/codec.ts` — don't assume legacy `{ success: boolean }` shapes for new code.

### Workspaces

A "workspace" is a parent folder that contains one or more git repos. The store keeps `workspaces: string[]`, `activeWorkspace`, and a **legacy** `workingDirectory` field. `migrateLegacyWorkingDirectory()` in `src/main/store.ts` promotes the legacy field into `workspaces` on first read and is called from every workspace getter/setter — it's idempotent. New code should prefer `getActiveWorkspace()` / `getWorkspaces()`; the `getWorkingDirectory` / `setWorkingDirectory` aliases exist only so older code paths keep working.

### Onboarding

`useOnboarding` (renderer) gates the UI: until `onboardingComplete` is set in the store, `App.tsx` renders `OnboardingScreen` instead of the tab UI. `scan-for-repos` IPC walks a directory one level deep and returns immediate child folders that are git repos.

### Preload path resolution

`electron-vite` may emit the preload as `.mjs`, `.js`, or `.cjs` depending on build mode. `resolvePreload()` in `src/main/index.ts` probes for each — don't hardcode the extension.

## Renderer test setup

`src/test/setup.ts` (loaded by `vitest.config.ts`) mocks the entire `window.electronAPI` surface with `vi.fn()`s, plus happy-dom polyfills for `matchMedia` and `ResizeObserver` (Radix/sonner/next-themes need them). `vi.resetAllMocks()` runs in `beforeEach`, so tests must set up their `electronAPI` mock returns inside the test (or `beforeEach`), not at module top level. `matchMedia` is intentionally defined as a plain function rather than a `vi.fn()` so `resetAllMocks` doesn't strip its implementation.

Main-process and shared tests run in plain Node with a short unit-test timeout. Sidecar tests use their own Node configuration with a longer timeout because they include real Git repositories and processes. Don't mock `BrowserWindow` / `ipcMain`; let E2E cover IPC integration. Don't unit-test Electron boilerplate (window creation, menus, updater) — smoke tests catch startup regressions.

## Style

Biome enforces: single quotes (JS), double quotes (JSX), no semicolons, 2-space indent, 100-col lines, `useImportType` as error, **`useBlockStatements` as error** (always brace `if`/`else`/`for`/`while`/`do`, including one-liners). Run `pnpm check:fix` before committing. shadcn components live in `src/renderer/components/ui/` (style: `new-york`, base color `neutral`, CSS vars enabled).

Use descriptive variable names. Don't use one-letter or terse abbreviations like `r`, `g`, `c`, `ps`, `vh` for things that aren't obvious from context — write `result`, `git`, `commit`, `parents`, `viewportHeight`. The only acceptable short names are well-known conventions: `i`/`j` for loop indices, `e` for event-handler parameters, `_` for an unused parameter, and a one-letter name inside a tiny lambda where the type makes the meaning obvious (e.g. `xs.map((x) => x.id)`). When in doubt, spell it out — a reader who didn't write the code should still be able to tell what each name refers to.

Default to writing **no comments**. Only add one when the WHY is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader. If removing the comment wouldn't confuse a future reader, don't write it. Don't explain WHAT the code does (well-named identifiers do that) and don't reference the current task, fix, PR, or callers — that rots as the codebase evolves. Same rule for docstrings: keep them to one short line, never multi-paragraph.

### Per-tab isolation in main

The renderer runs N tabs sharing one `webContents`, with an enforced invariant of **at most one tab per repo** — `useTabs.openRepoInTab` routes any attempt to open an already-open repo to the existing tab and discards the new one. So `repoPath` is effectively the per-tab key in main.

Two consequences:

- `gitInstances` and `activeFetches` are keyed by `repoPath`; that's already per-tab by the invariant, no refcount needed.
- Resources that can outlive a single repo session — log streams that need cancellation by tab, multi-window state — should still be keyed by `${webContentsId}:${repoPath}` (see `activeLogStreams` in `src/main/ipc/log-stream.ts`). Never key by `webContentsId` alone: a different-repo IPC from the same window would otherwise cancel the in-flight work of another tab and leave its loading state stuck.

When introducing a new per-repo resource in main, pick the narrower of the two keying strategies that still routes correctly. Don't add same-repo refcount/sharing logic — that case is unreachable.

## Agent skills

### Issue tracker

Issues (and external PRs) are tracked in this repo's GitHub Issues via the `gh` CLI; `/triage` treats external pull requests as a request surface alongside issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
