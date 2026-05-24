# Rebase — "Feels Instant" Rewrite Plan

> Status: **proposed**. Living document. Each PR section gets checked off as it merges.
> Owner: @Aahrix. Created 2026-05-24.

## 0. Why this exists

Rebase is fast enough on tiny repos and janky on real ones. The competitor we're
benchmarking against — `anomalyco/opencode`'s Electron desktop app — feels instant.
After auditing both codebases, the gap is **not** UI polish; it's architecture:

1. **Git runs on the main process.** Every `simple-git` call blocks the Electron main
   thread, which freezes the window (menu, traffic lights, the whole frame), not just a
   panel. (`src/main/ipc/*.ts` → `git.status()` etc.)
2. **No client cache.** Every `useEffect` re-fetches on mount/focus; tab switches re-run
   git. (`src/renderer/hooks/git/*`.)
3. **Cold-start flash.** The window opens white/grey before React mounts; no
   `backgroundColor`, no `show:false`, no theme preload. (`src/main/index.ts:38`,
   `src/renderer/index.html`.)
4. **No splash.** The "Loading…" div only appears *after* React boots, i.e. when it's
   no longer needed. (`src/renderer/App.tsx:26`.)
5. **React VDOM tax.** Every git result re-renders the panel tree; `<StrictMode>`
   double-runs in dev. (`src/renderer/main.tsx`.)

opencode fixes all five with: a forked HTTP **sidecar** for git/domain work, an Effect
domain layer bridged to the UI via a ~15-line `ManagedRuntime` adapter, SolidJS
fine-grained reactivity, a pre-painted window + theme preload, a real splash
`BrowserWindow`, list virtualization, and an unresponsive-recovery sampler.

This plan ports all of it, in mergeable slices.

## 1. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Get git off main thread | **Local HTTP sidecar** (`utilityProcess.fork`, HTTP on `127.0.0.1:<random>`) | Clean boundary, web-ready, no IPC class-instance serialization. Matches opencode. |
| UI framework | **Solid in, ship later** | PRs 1–7 land under React; Solid migration is PR 8+ on a long branch. Effect domain layer is framework-agnostic, so it lands first and Solid swaps on top. |
| Domain/runtime layer | **Effect** (`Effect`, `Schema`, `Stream`, `Layer`, `ManagedRuntime`) | Already used for IPC contracts (`src/shared/schemas/*`). opencode's pattern: Effect for backend/domain, framework for UI, bridged by `makeRuntime`. |
| UI↔Effect bridge | **Hand-written `makeRuntime` adapter** | opencode uses no `rx-*` library. Our `@effect-rx/rx-react` dep is unused dead weight — removed. |
| Client data cache | **Effect-based** (`Effect.cached` / `SubscriptionRef` / `Stream`) — **no** `@tanstack/*-query` | Honors the "no react-query / full Effect" stack direction; query libs are framework-coupled and we want the swap to be cheap. |

## 2. Architecture: before → after

**Before**
```
renderer (React) ──IPC invoke──> main process ──simple-git──> git (BLOCKS main thread)
                  <─structured clone (hand-serialized class instances)─
```

**After (PR 7 end state, still React)**
```
renderer (React)
  └─ Effect ManagedRuntime
       └─ HttpClient (Effect/platform) ──HTTP──> sidecar (utilityProcess)
                                                   └─ Effect domain services
                                                        └─ simple-git
main process: window lifecycle, splash, dialogs, store, deep links, updater, menu, zoom
              (NO git logic; only spawns/health-checks/kills the sidecar)
```

**After (PR 8+ end state)** — identical, renderer is SolidJS + Kobalte instead of React.

## 3. Conventions every PR follows

- **Validation gate (must pass before merge):** `pnpm lint && pnpm check && pnpm typecheck`
  plus the relevant test layer (`pnpm test:renderer` / `pnpm test:main` / `pnpm test:e2e`
  / `pnpm test:smoke`). CI (`test:ci`) is the hard gate; the `.githooks/pre-push` hook runs
  typecheck + check locally.
- **Tests required for every behavior change.** No exceptions (AGENTS.md §2). Pick the
  narrowest layer that proves the change.
- **Exact dependency versions, no `^`/`~`** (AGENTS.md §3). New build-script deps must be
  added to `pnpm.onlyBuiltDependencies`.
- **Each PR is independently mergeable and shippable.** No PR leaves `main` in a broken or
  half-migrated state. Behind-the-scenes work that isn't user-visible yet ships dark.
- **Descriptive names, no stray comments, Tailwind only, single font** (per repo memory +
  CLAUDE.md/AGENTS.md style rules).
- **Branch naming:** `feat/instant-NN-slug` (e.g. `feat/instant-01-boot-flash`).

## 4. Cross-cutting prerequisite — PR 0

### PR 0 — Reframe the binding rules + remove dead deps
**Branch:** `feat/instant-00-groundwork`

`AGENTS.md` currently forbids exactly what this plan does:
> "Prefer direct calls over IPC round-trips… Don't add HTTP servers, local APIs, or other indirections."
and pins React as the UI. We are deliberately reversing both. Do it explicitly, in one
small PR, so the rest of the train doesn't read as rule-breaking.

**Scope**
- `AGENTS.md`: replace the "no HTTP servers" principle with the new sidecar architecture
  rationale (main thread must never block; git runs in a forked process behind HTTP).
  Note React→Solid is in-progress, not a stable invariant.
- `CLAUDE.md`: update the "What this is" + Architecture sections to describe the sidecar and
  the planned renderer migration. Add a pointer to this plan file.
- `package.json`: remove unused `@effect-rx/rx-react` (grep-confirmed zero usages in `src/`).
- Rename the app: `package.json` `"name": "git-gui"` is stale; set to `"rebase"`.

**Risk:** docs-only + one dep removal. Near zero.
**Validation:** `pnpm typecheck && pnpm check && pnpm lint` (catches the removed dep).
**DoD:** docs reflect target architecture; `pnpm install` clean; no `@effect-rx` in lockfile.

## 5. The PR train

> PRs 1–2 are pure main-process/boot wins, zero renderer-architecture change — ship them
> first for immediate felt improvement and to de-risk the window lifecycle before the
> sidecar lands.

### PR 1 — Kill the cold-start flash
**Branch:** `feat/instant-01-boot-flash`
**Goal:** Window appears already painted in the user's theme color; no white frame, no
blank rectangle.

**Scope**
- `src/main/index.ts` `createWindow()`:
  - add `show: false`
  - add `backgroundColor` resolved from persisted theme (read from `electron-store`; fall
    back to the dark `--background` value, since `index.html` hard-codes `class="dark"`).
  - `mainWindow.once('ready-to-show', () => mainWindow.show())`
- `src/renderer/index.html`: add a tiny **synchronous** inline `<script>` in `<head>` that
  reads the persisted theme (via a `localStorage` mirror or a `<script src>` written by
  main) and sets `document.documentElement.style.backgroundColor` + the `dark`/`light`
  class before the module bundle loads. This removes the flash between native paint and
  first CSS.
- Persist the resolved background color to the store whenever the theme changes
  (`useThemeNonce.ts` / theme switch path) so the next cold start is correct.

**Risks:** `ready-to-show` can in rare cases not fire if load fails → window never shows.
Mitigation: also bind `did-finish-load` as a fallback `show()` and a hard timeout.
**Tests:** main unit test for the background-color resolver (pure fn). E2E: app launches
and window is visible (extend `e2e/app-launches.spec.ts`). Smoke: startup clean.
**DoD:** No visible white/blank frame on cold start on macOS + Linux. Theme matches last
session immediately.

### PR 2 — Real splash window — **FOLDED INTO PR 3**
> Resequenced 2026-05-24: a splash has nothing to report until the sidecar boot
> (PR 3) gives it real `init-step` progress. Building it standalone would mean
> throwaway synthetic steps. The splash window + `init-step` IPC now ship inside PR 3,
> wired to the actual sidecar spawn/health-check lifecycle.

**Branch:** `feat/instant-02-splash` (unused)
**Goal:** A lightweight splash `BrowserWindow` shown immediately on slow cold starts (first
launch, large-repo restore, future sidecar boot), closed when the main window is ready.

**Scope**
- New `src/main/windows.ts` (extract window creation out of `index.ts`):
  `createMainWindow()`, `createSplashWindow()`, shared `webPreferences`.
- New `src/renderer/splash.html` + `src/renderer/splash.tsx` (React, minimal): logo +
  indeterminate progress; subscribes to an `init-step` IPC event.
- `electron.vite.config.ts`: add `splash.html` as a second renderer rollup input (mirrors
  opencode's `loading.html` input).
- `src/main/index.ts`: show splash only if main isn't `ready-to-show` within ~600ms
  (avoid splash flicker on fast starts). Close splash on main `ready-to-show`.
- IPC: `init-step` channel (Schema-typed in `src/shared/schemas/ipc.ts`).

**Risks:** double-window flicker on fast machines → gate splash behind the 600ms timer.
**Tests:** main unit for the "should-show-splash" timing decision (pure, injectable clock).
E2E: forced-slow-start shows splash then main. Smoke: two-input build succeeds.
**DoD:** Slow starts show branded splash; fast starts show nothing extra.

### PR 3 — HTTP sidecar: move `simple-git` off the main thread
**Branch:** `feat/instant-03-sidecar`
**Goal:** All git work runs in a forked `utilityProcess` exposing an HTTP server on
`127.0.0.1:<random-port>` with a per-launch bearer token. Main no longer touches git.

**Scope**
- New `src/main/sidecar.ts` (the forked entry, mirrors opencode `sidecar.ts`):
  parses a `start` message `{ hostname, port, token }`, boots an HTTP server, posts
  `{ type: 'ready' }` / `{ type: 'error' }` back via `parentPort`.
- New `src/sidecar/` package dir for the server itself:
  - `server.ts` — `@effect/platform` `HttpApi` / `HttpServer` (Node). Routes built from the
    **existing** `src/shared/schemas/ipc.ts` tagged-union response schemas — reuse them as
    the request/response contracts so the wire format is already defined and typed.
  - Port the 7 IPC handler modules (`repo`, `status`, `log`, `log-stream`, `fetch`,
    `workspace`, `settings`) into Effect services that call `simple-git`. The
    `gitInstances` `Map<repoPath, SimpleGit>` (`src/main/state.ts`) moves into the sidecar.
  - `log-stream`: SSE or chunked HTTP stream keyed by `${connId}:${repoPath}` (preserve the
    per-tab isolation invariant from AGENTS.md — never key by connection alone).
- New `src/main/server.ts` (main side): `spawnSidecar()` (allocate free port via
  `net.createServer().listen(0)`, fork, await `ready`, health-check loop), `killSidecar()`
  on `before-quit`/`will-quit`/signals, restart-on-crash.
- `electron.vite.config.ts`: add `sidecar` as a second **main** rollup input + externalize
  native deps if any.
- **Keep `window.electronAPI` identical for now.** Main-process IPC handlers become thin
  proxies that forward to the sidecar over HTTP and return the same Schema-encoded shapes.
  → renderer is untouched in this PR; it's a pure backend swap. This is the safety valve:
  if the sidecar misbehaves we can revert just this PR.

**As-built (2026-05-24):** sidecar HTTP server uses Node's built-in `node:http` (zero
new deps, zero bundling risk) with the existing git logic moved **verbatim** and the
shared Effect `Schema`s as the wire format. Bearer-token auth on loopback. Request/response
ops moved: open/close/branches/status/stage/unstage/commit/log/checkout/fetch/scan, plus
`gitInstances` + fetch semaphores. **`log-stream` and `repoWatcher` stay in main** — they
use `spawn`/chokidar (already async, don't block) and `repoWatcher` needs `webContents`;
`openRepo`/`closeRepo` proxies keep the watcher in main. Moving streaming into the sidecar
(SSE forwarding) is deferred to a later PR. The renderer is untouched (still IPC); main
handlers are thin proxies. The Effect HttpClient + renderer-direct calls come in PR 4.

**Splash NOT built here.** PR 1 already eliminated the flash (`show:false` +
`backgroundColor` + theme preload) and the sidecar boots in <1s, so a splash window would be
speculative complexity with no slow-boot phase to cover. Dropped unless a genuinely slow
startup (large migration, remote scan) appears.

**Risks (highest-risk PR in the train):**
- Port races / EADDRINUSE → allocate-then-immediately-pass-fd pattern, retry.
- Sidecar crash leaves orphan process → robust kill on all exit paths + `child-process-gone`.
- Auth: bind loopback only + bearer token (random per launch) + `NO_PROXY` loopback.
- Streaming backpressure on `log-stream` → cap buffer, cancel on disconnect.
**Tests:** main unit for port allocation + health-check + token logic (pure/injectable).
Sidecar unit tests for each ported git service (these are the old `git/__tests__` tests,
moved). E2E: full open-repo → branches → status → commit flow over the sidecar.
Smoke: app boots, sidecar `ready` logged, no fatal errors.
**DoD:** Main thread never blocks on git (verify: hammer `git.log` on a huge repo while
dragging the window — stays smooth). All existing E2E flows pass unchanged.

### PR 4 — Effect domain layer + `makeRuntime` bridge in the renderer
**Branch:** `feat/instant-04-effect-runtime`
**Goal:** Introduce the framework-agnostic Effect runtime adapter and the HTTP client
service that the renderer will use, replacing ad-hoc `window.electronAPI` git calls.

**Scope**
- New `src/renderer/lib/runtime.ts`: port opencode's `makeRuntime` —
  `ManagedRuntime.make(Layer.provideMerge(AppLayer, ...))` exposing
  `runPromise/runFork/runSync` that resolve a service via `service.use(fn)`.
- New `src/renderer/lib/git-client.ts`: an Effect service wrapping
  `@effect/platform` `HttpClient` pointed at the sidecar URL (URL+token handed to the
  renderer via a single `get-sidecar-config` IPC call at boot). Methods mirror the git API,
  decode responses with the shared Schemas.
- Refactor `src/renderer/hooks/git/*` to call `runtime.runPromise(git => git.status(...))`
  instead of `window.electronAPI.getStatus`. Behavior identical; plumbing changed.
- `package.json`: add `@effect/platform`, `@effect/platform-browser` (exact versions).

**Risks:** double async layers (IPC for config + HTTP for data) → fetch config once at
boot, memoize. Schema decode errors must surface as the existing tagged-union errors.
**Tests:** renderer unit for `makeRuntime` (run a trivial Effect through it). renderer unit
for `git-client` decode paths with a mocked `HttpClient`. Existing hook tests adapted.
**DoD:** Renderer talks to the sidecar via Effect `HttpClient`; `@effect-rx` fully gone;
all renderer tests green.

### PR 5 — Effect-based client cache (kill redundant fetches)
**Branch:** `feat/instant-05-cache`
**Goal:** Tab switches and window refocus are instant — served from cache, revalidated in
the background. No more "every mount re-runs git."

**Scope**
- New `src/renderer/lib/git-cache.ts`: a `SubscriptionRef`-backed, per-`repoPath` cache for
  status/branches/log with stale-while-revalidate semantics. Invalidation driven by the
  existing `repo-changed` / file-watcher events (`src/main/repoWatcher.ts` → forwarded
  through the sidecar as a stream).
- Wire `onRepoChanged` / `onLogChunk` event streams (`src/preload/index.ts`) into the cache
  as `Stream`s feeding the `SubscriptionRef`.
- Hooks (`useGitState`, `useAutoFetch`) read from the cache instead of firing their own
  effects; optimistic updates for stage/unstage/commit.

**Risks:** stale cache after external git changes → rely on the file watcher; add a manual
refresh affordance. Memory growth across many tabs → evict on tab close (`useTabs.closeTab`).
**Tests:** renderer unit for cache hit/miss/invalidate/SWR (deterministic with a fake
clock + fake stream). renderer unit for optimistic stage→commit rollback on error.
**DoD:** Switching between two open-repo tabs shows data instantly (cache hit) and
revalidates silently; profiling shows no git call on pure tab switch.

### PR 6 — Virtualize lists + fast fuzzy search
**Branch:** `feat/instant-06-virtual-fuzzy`
**Goal:** Long history/file lists render only visible rows; pickers filter instantly.

**Scope**
- Replace the bespoke `src/renderer/hooks/useVirtualList.ts` usage with
  `@tanstack/react-virtual` (exact version) in `HistoryPanel`, `StatusPanel` file lists,
  and `RepoPicker`/`WorkspaceSwitcher` lists — wherever lists can grow unbounded.
  (Keep `useVirtualList.ts` only if it already outperforms; otherwise delete it.)
- Add `fuzzysort` (exact version) for command palette (`components/ui/command.tsx` / `cmdk`)
  and file/repo filtering.
**Risks:** virtualization + variable row heights → measure or fixed-height rows. Keyboard
nav must still work with windowed rows.
**Tests:** renderer unit for fuzzy ranking; renderer unit that a 10k-row list mounts only N
DOM rows. E2E: scroll a large history, search the palette.
**DoD:** 10k-commit history scrolls at 60fps; palette filter is instant on 1k+ items.

### PR 7 — Reliability: unresponsive sampler + recovery + cleanup
**Branch:** `feat/instant-07-recovery-cleanup`
**Goal:** Match opencode's resilience; remove everything the rewrite orphaned.

**Scope**
- Port `createUnresponsiveSampler` + `wireWindowRecovery` (opencode `windows.ts`): on
  `win.on('unresponsive')` show a "Relaunch / Export Logs / Keep Waiting" dialog; log
  `render-process-gone` / `child-process-gone`; sample JS call stacks.
- **Deletions** (the "remove everything not needed" pass): old main-process git modules now
  living in the sidecar (`src/main/git/*` if fully moved), `src/main/state.ts`
  `gitInstances` if relocated, dead `getWorkingDirectory`/`setWorkingDirectory` legacy
  aliases if no longer referenced, `useVirtualList.ts` if replaced, `@effect-rx` (already
  gone), any now-unused serialize helpers replaced by Schema-over-HTTP.
- Tighten `pnpm.onlyBuiltDependencies` for any new native build deps.
**Risks:** deleting something still referenced → rely on `pnpm typecheck` + full test:ci.
**Tests:** main unit for the recovery decision logic (pure). Grep + typecheck confirm no
dangling imports. Full `test:ci` green.
**DoD:** Unresponsive renderer offers recovery; `knip`/`tsc` report no dead exports;
bundle shrinks.

> **── SHIP LINE ──** After PR 7, the app is feels-instant on React. Measure real perf
> before committing to PR 8. If Solid's marginal gain isn't worth the churn, stop here.

### PR 8+ — SolidJS migration (long-lived branch, UI layer only)
**Branch:** `feat/instant-08-solid` (sub-PRs merge into it; it merges to `main` once)
**Goal:** Replace React with SolidJS + Kobalte. Effect domain layer, sidecar, cache, and
shared schemas are **untouched** — this is purely the UI rendering layer.

**Sub-steps (each its own commit/PR into the long branch):**
1. Scaffold: `solid-js`, `vite-plugin-solid`, `@kobalte/core`, `solid-sonner`,
   `lucide-solid`, `corvu` (or `solid-resizable-panels-ko`), Solid Testing Library.
   Stand up a second renderer entry; keep React entry alive until cutover.
2. Port `makeRuntime` consumers to Solid signals/stores (the adapter itself is unchanged —
   `runPromise` into a `createResource`/`createStore`).
3. Port `components/ui/*` (23 shadcn components → Kobalte equivalents; use `shadcn-solid`
   as the source, not hand-rolled).
4. Port feature components: `HistoryPanel`, `StatusPanel`, `CommitPanel`, `OnboardingScreen`,
   `shell/*`, `TabBar`, `RepoPicker`, `Workspace`, `TabView`, `App`.
5. Port hooks (`useTabs`, `useOnboarding`, `useGit*`, `useDraggableWidth`) — most shrink
   30–50% under Solid's implicit reactivity.
6. Rewrite renderer unit tests under Solid Testing Library (Playwright E2E carry over
   unchanged — they assert on DOM).
7. **Cutover commit:** switch `electron.vite.config.ts` renderer entry to Solid; delete
   React (`react`, `react-dom`, `@vitejs/plugin-react`, `@testing-library/react`, all
   `.tsx` React components, `StrictMode`, `next-themes` → Solid theme primitive).
**Risks:** biggest churn; do it on a branch that rebases on `main` regularly. shadcn
`new-york` visual drift → an explicit polish pass. Keep React shippable until the cutover
commit.
**Tests:** Solid renderer tests reach parity with the old React suite before cutover.
Full `test:ci` green on the branch before merge.
**DoD:** App runs on SolidJS; React fully removed from `package.json` and `src/`; bundle
smaller; no re-render tax on git updates.

## 6. What gets deleted (running list)
- `@effect-rx/rx-react` (unused) — PR 0.
- Main-process git modules once relocated to the sidecar — PR 7.
- `gitInstances` from `src/main/state.ts` (moves to sidecar) — PR 3/7.
- Hand-rolled serialize helpers superseded by Schema-over-HTTP — PR 7.
- `useVirtualList.ts` if `@tanstack/react-virtual` replaces it — PR 6.
- React + ReactDOM + `@vitejs/plugin-react` + `@testing-library/react` + `next-themes`
  + all React `.tsx` — PR 8 cutover.

## 7. Dependency ledger (exact versions, decided at add-time)
| PR | Add | Remove |
|---|---|---|
| 0 | — | `@effect-rx/rx-react` |
| 3 | `@effect/platform`, `@effect/platform-node` | — |
| 4 | `@effect/platform-browser` | — |
| 6 | `@tanstack/react-virtual`, `fuzzysort` | (`useVirtualList.ts`) |
| 8 | `solid-js`, `vite-plugin-solid`, `@kobalte/core`, `solid-sonner`, `lucide-solid`, `corvu`, `@solidjs/testing-library` | `react`, `react-dom`, `@vitejs/plugin-react`, `@testing-library/react`, `next-themes`, `radix-ui`, `@radix-ui/react-slot`, `cmdk`, `react-resizable-panels`, `lucide-react` |

## 8. Sequencing & parallelism
- **Serial spine:** PR 0 → 1 → 2 → 3 → 4 → 5. (4 depends on 3; 5 depends on 4.)
- **Parallelizable:** PR 6 (virtual/fuzzy) can start after PR 4 independently of PR 5.
- PR 7 last before the ship line. PR 8 is a long branch kicked off any time after PR 4,
  finished after PR 7.
