# Refactor Plan

This file is the durable record of the multi-phase refactor of Rebase. Companion to `AGENTS.md` (binding rules) and `CLAUDE.md` (operational guidance). Update as work progresses.

**Status:** Phase 1 complete (6 commits, 136 green tests). Phase 2 not yet started.

**Scale target:** Rebase is growing into a *complete* git GUI — diff, blame, interactive rebase, conflict resolution, multi-remote, push/pull, search, history navigation. The architecture choices below are picked for that ceiling, not just the current 6.7K-LOC surface.

---

## Library direction

**Adopt Effect everywhere** (`effect/Schema`, `effect/Effect`, `effect/Stream`). Renderer + main + shared. Confirmed in conversation.

- New IPC payloads → `effect/Schema` in `src/shared/schemas/` (no Electron imports). Validate on **both** sides of the bridge.
- Main-process git operations → `Effect` programs with tagged errors (`Effect.tryPromise` wrapping `simple-git`).
- Long-running / streaming git operations (log, diff, blame) → `effect/Stream`, fiber-cancellable.
- Renderer state from IPC → consume Effects through `@effect-rx/rx-react` (or equivalent). **Do not graft react-query on top.**

Do NOT add: `zod`, `neverthrow`, `@tanstack/react-query`, additional state libraries. Effect replaces them.

The hand-rolled `createDebouncer` and `tryReserveFetch` get replaced by `Stream.debounce` / `Semaphore` when their callers move to Effect (Phase 2 / 4).

---

## Diagnosis snapshot (from the initial review)

Issues identified at the start. Tick = fixed in Phase 1.

**Bugs / user-visible defects**
- [x] Closing a tab leaks main-side `gitInstances` + chokidar watcher (fixed `6f03d79`)
- [x] `serializeStatus` drops conflicted / deleted / renamed / created (fixed `e1bc84b`)
- [x] Topbar Pull / Push / ahead-behind / sidebar `onSelectRef` were inert UI (removed `6977df3`)
- [x] Auto-fetch errors silently swallowed → no surfaced feedback (deferred — `Toaster` removed in `6977df3`; reintroduce when wiring real toast messages)
- [x] `useGit.refreshRepo` dead code (removed `3dcbc4c`)
- [x] `workingTree` watcher doesn't honour gitignore — event storms on build outputs (mitigated `1d5e6cf`; full gitignore-aware version deferred)
- [x] `zustand` in deps but unused (removed `3dcbc4c`)
- [x] Stray store keys (`sidebarOpen`, `sidebarRefTreeToggles` not in schema) — handled in Phase 2
- [ ] Onboarding can complete with zero repos (minor UX, deferred)
- [x] `gitInstances` keyed by raw path string (normalized `dd67809`)

**Architecture issues (still pending)**
- IPC type erosion — preload returns `Promise<unknown>`, renderer casts everywhere → **Phase 2**
- `src/main/index.ts` is 601 lines, all IPC handlers + serializers + window lifecycle → **Phase 3**
- `useGit` is a 370-line god-hook with 5+ refresh paths racing → **Phase 4**
- `HistoryPanel.tsx` is 799 lines mixing layout, canvas, ref parsing, virtualisation, theme observer → **Phase 3**
- `App.tsx` bundles 5 components → **Phase 3**
- Generic `getStoreValue`/`setStoreValue` proxy bypasses the schema → **Phase 2**
- `useOnboarding.selectWorkingDirectory` ≈ `addWorkspace` (duplicate) → **Phase 3**
- Loading-state conflation (one `loading` for openRepo + commit) → **Phase 4**
- Unused schema keys (`windowState`, `historyColWidths`) → **Phase 2**

---

## Phase 1 — defects (DONE)

Library-agnostic bug fixes. One commit per defect. All green.

| Commit | Subject |
|---|---|
| `3dcbc4c` | remove dead code: refreshRepo hook export and unused zustand dep |
| `dd67809` | normalize repo paths at the IPC boundary |
| `1d5e6cf` | extend repoWatcher ignore list beyond .git and node_modules |
| `6f03d79` | release the repo on the main side when a tab closes |
| `6977df3` | remove dead Pull/Push/ahead-behind UI and unused Toaster |
| `e1bc84b` | surface conflicted, deleted, renamed, and created files in status |

**Tests:** 136 green (111 renderer + 25 main).

---

## Phase 2 — Effect introduction + IPC type tightening (PENDING)

The first phase that adds a dependency. Each commit independently green.

1. **Add `effect` + `@effect-rx/rx-react` deps** at exact pinned versions (per AGENTS.md).
2. **Create `src/shared/schemas/`** with `git.ts` (GitStatus, GitLogEntry, GitBranches, RepoOpenResult) and `ipc.ts` (channel name constants + per-channel request/response schemas). No Electron imports — both sides depend on it.
3. **Port `get-status` end-to-end as the pilot**:
   - Main: `serializeStatus` runs the `Schema.encodeSync` on its way out.
   - Preload: type the channel precisely, drop `Promise<unknown>`.
   - Renderer: replace the `as StatusResult` cast in `useGit` with `Schema.decodeUnknownSync` at the boundary.
   - Tagged errors (`RepoNotOpen`, `GitError`) replace the `{ success, error }` ADT for this handler.
4. **Repeat for `get-branches`, `open-repo`, `get-log`, `stage-file`, `unstage-file`, `commit`, `git-fetch`, `start-log-stream`, `cancel-log-stream`, `scan-for-repos`**. One commit per handler keeps blast radius small.
5. **Replace the generic `getStoreValue`/`setStoreValue` proxy** with typed accessors per persisted UI pref (`getSidebarPrefs`, `setSidebarPrefs`, `getRefTreeToggles`, `setRefTreeToggles`). Remove unused `windowState` and `historyColWidths` from the store schema. Add the previously off-schema keys (`sidebarOpen`, `sidebarRefTreeToggles`).
6. **Add a renderer-side `decodeOrThrow` helper** that wraps every IPC response — so drift between main's serializer and renderer's expectations crashes in dev immediately, not silently at render time.

**Done when:** zero `as ResultXxx` casts in `src/renderer/`, every preload method is precisely typed, schemas live in `src/shared/`, and the renderer / main both reference the same Schema constants.

---

## Phase 3 — file-level decomposition (PENDING)

No new deps. Just splitting the god-files into focused modules.

1. **Split `src/main/index.ts`** (601 lines) into:
   ```
   src/main/index.ts                # window lifecycle + IPC registration only
   src/main/ipc/{repo,status,log,log-stream,fetch,workspace,settings}.ts
   src/main/git/{serialize,defaultBranch}.ts
   ```
   Each `ipc/*.ts` exports `register(): void`.
2. **Split `HistoryPanel.tsx`** (799 lines):
   ```
   src/renderer/lib/git-graph/{layout,refs,canvas}.ts
   src/renderer/lib/format.ts            # formatCommitDate, initials
   src/renderer/hooks/useVirtualList.ts  # generic; reused by RefTreePanel
   src/renderer/hooks/useThemeNonce.ts
   src/renderer/components/HistoryPanel/{HistoryPanel,CommitRow,CommitGraphCanvas,HistoryHeader,SkeletonRows}.tsx
   ```
3. **Migrate `RefTreePanel`** to `useVirtualList` (eliminate duplicated scroll/overscan logic).
4. **Split `App.tsx`** (531 lines):
   ```
   src/renderer/App.tsx                  # top-level only
   src/renderer/TabView.tsx
   src/renderer/RepoPicker/{RepoPicker,RepoGroup,RepoRow}.tsx
   src/renderer/Workspace.tsx
   src/renderer/hooks/useTabs.ts
   ```
5. **Collapse `useOnboarding.selectWorkingDirectory` into `addWorkspace`** (they're 95% identical).
6. **Hoist `parseRemoteHost` / `detectProvider`** out of `RemoteProviderIcon` into `src/renderer/lib/providers.ts`.

**Done when:** no source file (excluding tests and shadcn `ui/` primitives) is over ~250 lines.

---

## Phase 4 — state architecture with Effect (PENDING, biggest)

Replace `useGit` and the imperative refresh dance with composed Effect-driven slices.

1. **Move per-tab state to Effect + Rx**: split `useGit` into independent slices (`repo`, `status`, `branches`, `log`, `watcher`, `autoFetch`) each backed by an Rx atom or SubscriptionRef. The `useGit(repoPath)` facade just composes them.
2. **Rewrite the log stream as `Stream<Commit>`** end-to-end: main produces it, renderer consumes via `Stream.runForEach` into the log slice. Cancellation is structural (fiber interrupt on tab switch), not a manual `cancelLogStream` IPC.
3. **Replace hand-rolled primitives** in main: `createDebouncer` → `Stream.debounce`, `tryReserveFetch` → `Semaphore`. Delete those files.
4. **Per-tab store instances** via React context. Each tab's slices are isolated; no more module-level `tabRepos` bookkeeping in `App.tsx`.
5. **Separate loading states**: `opening` vs `committing` vs per-domain `*Loading`. The current single `loading` boolean is overloaded.
6. **Persist tabs across app restarts** (common feature for multi-repo GUIs). Save `{ tabs, activeTabId, tabRepos }` to electron-store; restore on boot.
7. **Add tab keyboard nav**: Cmd+Shift+] / Cmd+Shift+[ for next/prev tab.

**Done when:** `src/renderer/hooks/useGit.ts` is under ~80 lines and there are no manual `activePathRef.current` race guards.

---

## Beyond the four phases (backlog)

- **Implement Pull / Push / branch-checkout-on-click** (the affordances removed in Phase 1).
- **Real ahead/behind** via `git rev-list --count --left-right HEAD...@{upstream}`. Surface in Topbar + Statusbar.
- **Gitignore-aware watcher**: replace the static `IGNORED_DIRS` list with a `git ls-files --others --ignored --exclude-standard` snapshot refreshed on `.gitignore` change. Or pivot entirely to watching `.git/index` plus a sparse handful of working-tree dirs.
- **Hunk-level staging**, **diff viewer**, **blame**, **interactive rebase wizard**, **conflict resolver** — feature work that benefits from the Phase 2/4 foundation.
- **`Toaster` reinstate** wired to fetch failures, commit errors, and other transient feedback that doesn't belong in the inline error banner.

---

## Constraints & operating principles

These are non-negotiable and apply to every commit:

- **Exact dependency versions** (no `^` / `~`). `pnpm add effect@<exact>`.
- **Restricted postinstall scripts** via `pnpm.onlyBuiltDependencies`.
- **Every behaviour change needs a test** in the right layer (renderer / main / smoke / e2e).
- **Validation on every commit**: `pnpm typecheck && pnpm check && pnpm lint && pnpm test:renderer && pnpm test:main`.
- **Many small green commits** over one big refactor commit. Each must build, lint, and test independently.
- **Tailwind, never `shell.css`** for styling.
- **Single font everywhere in the renderer** — no selective `font-mono`.
- **No mocking the database / electron IPC** in unit tests. Pure logic only in main tests; let E2E cover integration.
- **Don't half-finish**: an affordance in the UI either works or it isn't rendered.
