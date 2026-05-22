# Refactor Plan

This file is the durable record of the multi-phase refactor of Rebase. Companion to `AGENTS.md` (binding rules) and `CLAUDE.md` (operational guidance). Update as work progresses.

**Status:** Phase 1 complete (6 commits, 136 green tests). Phase 2 complete (13 commits, 146 green tests). Phase 3 complete (7 commits, 149 green tests). Phase 4 not yet started.

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
- [x] IPC type erosion — preload returns `Promise<unknown>`, renderer casts everywhere (fixed in Phase 2)
- [x] `src/main/index.ts` is 601 lines, all IPC handlers + serializers + window lifecycle (split in Phase 3)
- `useGit` is a 370-line god-hook with 5+ refresh paths racing → **Phase 4**
- [x] `HistoryPanel.tsx` is 799 lines mixing layout, canvas, ref parsing, virtualisation, theme observer (split in Phase 3)
- [x] `App.tsx` bundles 5 components (split in Phase 3)
- [x] Generic `getStoreValue`/`setStoreValue` proxy bypasses the schema (fixed in Phase 2)
- [x] `useOnboarding.selectWorkingDirectory` ≈ `addWorkspace` (duplicate) (collapsed in Phase 3)
- Loading-state conflation (one `loading` for openRepo + commit) → **Phase 4**
- [x] Unused schema keys (`windowState`, `historyColWidths`) (fixed in Phase 2)

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

## Phase 2 — Effect introduction + IPC type tightening (DONE)

The first phase that adds a dependency. Each commit independently green.

| Commit | Subject |
|---|---|
| `743b124` | add effect and @effect-rx/rx-react at exact pinned versions |
| `f0d3986` | introduce src/shared schemas + decodeOrThrow |
| `23e04d1` | port get-status to schema-encoded tagged responses |
| `121a339` | port get-branches to schema-encoded tagged responses |
| `bea4362` | port open-repo to schema-encoded tagged responses |
| `e3caf5a` | port get-log to schema-encoded tagged responses |
| `73a6988` | port stage-file and unstage-file to schema-encoded tagged responses |
| `350a058` | port commit to schema-encoded tagged responses |
| `0478fcb` | port git-fetch to schema-encoded tagged responses |
| `1159c26` | port log streaming + cancel + log-chunk event to shared schemas |
| `88fafba` | port scan-for-repos and close-repo to shared channel constants |
| `d52f87d` | replace generic store proxy with typed accessors |
| `e79fa18` | tighten close-repo type: Promise<void> instead of Promise<unknown> |

**Tests:** 114 renderer + 32 main = 146 green.

**What landed:**

- `effect@3.21.2` and `@effect-rx/rx-react@0.42.4` (exact pinned). The Rx package is in
  place ahead of Phase 4 — Phase 2 only depends on `effect/Schema`.
- `src/shared/schemas/git.ts` holds the schema-derived domain types
  (`GitStatus`, `GitLog`, `GitBranches`, `RepoOpenSuccess`, `CommitSummary`,
  `LogChunk`, `RepoChangedEvent`). All arrays use `Schema.mutable` to keep
  callers compatible with the existing renderer code.
- `src/shared/schemas/ipc.ts` holds channel-name constants and per-channel
  response envelopes. Failures are tagged unions of `RepoNotOpen`, `NotARepo`,
  `FetchSkipped`, and `GitError`.
- `src/shared/codec.ts` exports `decodeOrThrow` / `encodeOrThrow`.
- Every renderer-touching IPC handler now encodes through its Schema on main
  and decodes via `decodeOrThrow` on the renderer.
- Preload methods are precisely typed (no more `Promise<unknown>` for
  RPC-style channels).
- `getStoreValue` / `setStoreValue` are gone. Persisted UI prefs go through
  `getSidebarPrefs` / `setSidebarPrefs` / `getRefTreeToggles` /
  `setRefTreeToggles`. The store schema drops `windowState` (managed by
  electron-window-state) and `historyColWidths` (unused).
- `@shared/*` path alias added to tsconfig (renderer + node), vite, and both
  vitest configs.

---

## Phase 3 — file-level decomposition (DONE)

No new deps. Just splitting the god-files into focused modules.

| Commit | Subject |
|---|---|
| `dc3a185` | split main/index.ts into ipc/* and git/* modules |
| `a763813` | hoist provider helpers into renderer/lib/providers.ts |
| `1af89b2` | collapse useOnboarding.selectWorkingDirectory into addWorkspace |
| `c804b93` | split HistoryPanel.tsx into lib/git-graph + hooks + components |
| `ffed6fa` | migrate RefTreePanel to useVirtualList |
| `2ecb4d4` | extract ref-tree helpers and row view from RefTreePanel |
| `ec04c55` | split App.tsx into TabView, RepoPicker, Workspace, useTabs |

**Tests:** 117 renderer + 32 main = 149 green.

**What landed:**

- `src/main/index.ts` shrinks from 666 to 89 lines and only handles
  window lifecycle + IPC registration. Handlers move to
  `src/main/ipc/{repo,status,log,log-stream,fetch,workspace,settings}.ts`,
  each exporting `register()`. Serializers + `resolveDefaultBranch` move
  to `src/main/git/{serialize,defaultBranch}.ts`. Shared mutable maps
  (`gitInstances`, `activeFetches`) live in `src/main/state.ts`.
- `HistoryPanel.tsx` (799 lines) splits into
  `src/renderer/lib/git-graph/{layout,refs,canvas}.ts`,
  `src/renderer/lib/format.ts`,
  `src/renderer/hooks/{useVirtualList,useThemeNonce}.ts`, and a
  `src/renderer/components/HistoryPanel/` folder with `HistoryPanel`,
  `CommitRow`, `CommitGraphCanvas`, `HistoryHeader`, `SkeletonRows`, plus
  a `selectors.ts` for the on-branch / visible-set computations. The
  canvas redraw is imperative (via `useImperativeHandle`) so the scroll
  raf calls it without a state round-trip.
- `RefTreePanel` is refactored to use `useVirtualList`. The row data
  model and tree-flattening move into `src/renderer/lib/ref-tree.ts`;
  the per-row presentational component moves into
  `src/renderer/components/shell/RefTreeRow.tsx`. The panel itself drops
  from 389 to 106 lines.
- `App.tsx` shrinks from 527 to 95 lines. It now only handles the
  onboarding gate and the tab shell. Per-tab logic lives in
  `src/renderer/TabView.tsx`; the empty-tab repo picker lives in
  `src/renderer/RepoPicker/{RepoPicker,RepoGroup,RepoRow}.tsx`; the
  in-repo dashboard lives in `src/renderer/Workspace.tsx`; the tab list
  state machine + Cmd+T/Cmd+W shortcuts live in
  `src/renderer/hooks/useTabs.ts`.
- `useOnboarding.selectWorkingDirectory` is gone — the onboarding
  "Select Working Folder" button now calls `addWorkspace`, since the two
  callbacks were 100% identical.
- `parseRemoteHost` and `detectProvider` are hoisted into
  `src/renderer/lib/providers.ts` so they're reusable without dragging
  in the `RemoteProviderIcon` component.

`useGit.ts` (401 lines) is the only renderer file still over the
~250-line target; that's Phase 4's job. `StatusPanel.tsx` (261 lines) is
marginally over but wasn't called out for Phase 3 — leave it for a future
pass if it needs further breakdown.

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
