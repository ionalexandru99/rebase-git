# Rebase — Engineering Remediation & Effect Adoption Plan

> Single source of truth for fixing what the multi-agent audit found (101 findings across 12
> dimensions) **and** for adopting Effect (Schema / Stream / Effect) across the app. Written so an
> agent with **no prior context** can execute any task in order. Read §0 first, then work the
> phases top-to-bottom. Each task is self-contained: files, current state, exact change, gotchas,
> tests, and acceptance.

**Status:** not started. **Owner:** maintainer (Aahrix). **Created:** 2026-06-16.

---

## 0. Context an executing agent must load first

### 0.1 What Rebase actually is (the docs lie — trust this section)

Rebase is a desktop Git GUI: **Electron 41 + TypeScript 5.8 + Tailwind 4**, `pnpm`. Four processes
with a hard boundary:

| Process | Owns | Never does |
|---|---|---|
| `src/main/` | window lifecycle, `electron-store`, dialogs, menu, updater, spawn/health/kill of the sidecar, repo file-watching (`chokidar`), and **proxies every git IPC to the sidecar over loopback HTTP** | git logic |
| `src/sidecar/` | a forked `utilityProcess` HTTP server on `127.0.0.1:<random>` with bearer-token auth; **all** `simple-git` work; `Map<repoPath, SimpleGit>` | window/UI |
| `src/preload/` | typed `window.electronAPI` `contextBridge` | hold the sidecar token (it never does) |
| `src/renderer/` | React 19 UI | Node access; direct network |
| `src/shared/` | Zod wire contracts shared across processes | — |

**The single most important correction to the existing docs:** `CLAUDE.md` and `AGENTS.md` claim the
renderer is **SolidJS** and talks to the sidecar via **native `fetch` + a preload `getSidecarConfig`
(URL+token)**. Both are false.

- The renderer is **React 19** (`react@19.2.6`, `@tanstack/react-query`, `@tanstack/react-virtual`).
  There is no `solid-js` dependency.
- The real transport is **renderer → IPC (`window.electronAPI.sidecarRequest`) → main → loopback
  HTTP → sidecar**. The token and URL stay entirely inside main+sidecar. This is *better* than the
  documented design (no token in the renderer, no CSP loopback exception). **Do not "fix" it to
  native fetch.** See `src/renderer/lib/sidecar-fetch.ts:11`, `src/preload/index.ts:87-88`,
  `src/main/ipc/settings.ts:31-36`.
- Docs also claim **deep links** and a **single-instance lock** — neither exists in code.

### 0.2 The headline problem (root cause of ~30 findings)

The renderer was migrated SolidJS→React (`054d4c8`) by building a **SolidJS-emulation shim** instead
of rewriting to idiomatic React. The whole renderer still speaks Solid through
`src/renderer/lib/react-*-compat.*`, imported by **63 of 82 `.tsx` files**:

| Solid idiom (emulated) | Renderer usages |
|---|---|
| `<Show>` | 147 |
| `createSignal` | 37 |
| `createMemo` | 18 |
| `splitProps` | 17 |
| `For` | 16 |
| `onCleanup` / `onMount` | 9 / 8 |
| `createEffect` | 8 |

The shims carry **verified correctness/perf defects** (not opinions):

- `react-compat.tsx:89` `createMemo` runs `compute()` **every render** — it never memoizes.
- `react-compat.tsx:117` `createEffect`/`onMount` register `useEffect` with **no deps** — fire every render.
- `react-compat.tsx:34` reads React private `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`.
- `react-store-compat.ts:45` `createStore` does `Object.assign(stateRef.current, next)` — **mutates one
  object in place**, identity never changes, so `React.memo`/`useMemo([state])` can never detect a
  change. The 1052-line core store `src/renderer/stores/git.tsx:243` is built on this.
- `react-virtual-compat.ts` is one line (`export const createVirtualizer = useVirtualizer`);
  `react-query-compat.ts` is a pure thunk rename; `react-dom-compat.tsx` wraps `createRoot`.

**Consequence for sequencing:** Effect must not be layered on top of this. We de-risk and de-Solidify
first (Phases 0–2), then bring Effect in as the vehicle for the real architecture fix (Phase 3+).

### 0.3 Effect decision (committed)

The maintainer wants Effect. **Effect is in.** The audit's caution was *not* "don't do Effect" — it
was "don't do it first, and don't drop react-query before there's a single source of truth." This
plan honors both: Effect enters in **Phase 3** as Schema + `@effect/rpc` (which is exactly the
op→request/response registry the audit's #1 architecture finding asks for), and deepens in **Phase 6**
(Effect in the sidecar domain layer + `Stream` for the log stream). By then the renderer is idiomatic
React and the cache is a single source of truth, so Effect lands on clean ground.

### 0.4 Conventions every task must follow

- **Style (Biome-enforced):** single quotes JS / double quotes JSX, no semicolons, 2-space indent,
  100-col lines, `useImportType` as error, **`useBlockStatements` as error** (always brace
  `if`/`else`/`for`/`while`, even one-liners). Run `pnpm check:fix` before committing.
- **Names:** descriptive. No `r`/`g`/`c`/`ps`/`vh`. Loop `i`/`j`, event `e`, unused `_` are fine.
- **Comments:** none. Never write one — not WHAT, not WHY, not JSDoc, not a `TODO`. Put the meaning
  in names, types, and structure, or in the PR description. The only exception is a directive the
  tooling reads (`biome-ignore`, `@ts-expect-error`, `@vitest-environment`).
- **Styling:** Tailwind only — never edit `shell.css`. One sans-serif system font everywhere (no
  selective `font-mono` on hashes/paths/filenames).
- **Tests are required** for every behavior change. Pick the layer (see §0.5).
- **Exact dependency versions** — no `^`/`~`. `pnpm add pkg@x.y.z`. New Effect packages are pure JS
  and need no `pnpm.onlyBuiltDependencies` entry.
- **Branch/PR flow:** the maintainer pushes. For each task (or tight task group) create a **stacked
  local branch**, commit, and stop — do not push or open PRs. Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### 0.5 Validation — run on EVERY task before declaring it done

```bash
pnpm typecheck      # tsc --noEmit && tsc -p tsconfig.node.json --noEmit
pnpm check          # biome format + lint
pnpm lint           # biome lint (memory: always include this)
# then the layer that matches the change:
pnpm test:renderer  # src/renderer/**  (jsdom, electronAPI mocked)
pnpm test:main      # src/main/**, src/shared/**  (node, pure logic only)
pnpm test:e2e       # playwright against the built binary (IPC/integration)
pnpm build && pnpm test:smoke   # startup sanity (smoke needs a build first)
```

A task is **not done** until typecheck + check + lint + the relevant test layer are green.

### 0.6 Global gotchas

- **Renderer tests** reset all mocks in `beforeEach` (`src/test/setup.ts`); set `electronAPI` return
  values *inside* the test, not at module top level. The mock **throws on unknown sidecar ops** — see
  Task P0-9 which fixes this so mutation hooks are testable.
- **Per-tab isolation:** at most one tab per repo is enforced (`useTabs.requestOpenRepo`,
  `useTabs.ts:84`), so `repoPath` is the per-tab key. Resources that outlive a tab (log streams) must
  key by `` `${webContentsId}:${repoPath}` `` (see `ipc/log-stream.ts`). `repoWatcher` currently
  violates this (Task P2-9).
- **No `<StrictMode>`** today — it would crash under the current shim. Re-enabling it is the
  **definition-of-done gate** for the de-shim (Phase 5), not something to bolt on early.
- The sidecar's git-core primitives (`repo-lock`, `fetch-semaphore`, NDJSON log streaming, the `-z`
  ref parsers in `git/tracking.ts`/`git/log-format.ts`/`git/serialize.ts`) are **correct — keep
  them.** Do not rewrite streaming over websockets (see §Strategic verdicts).

### 0.7 Strategic verdicts (from adversarial review — decided)

| Idea | Verdict | Why |
|---|---|---|
| **Effect everywhere** | **ADOPT, sequenced** (Phase 3 + 6) | Real value at the contract boundary + log stream; land it after de-Solidify + single cache. |
| **WebSockets/SSE renderer↔sidecar** | **REJECT** | There is *no polling* (`staleTime 30s`, no `refetchInterval`); IPC already *is* the push channel; the renderer has no network access. The "realtime" gaps are watcher-coverage bugs (Phase 2), not transport. |
| **SVG/DOM commit graph** | **REJECT** | Canvas is correct: the rail is `pointer-events-none`+`aria-hidden`, interaction/a11y live on the DOM rows. SVG = O(rows×lanes) node churn per frame for zero gain. Only port the canvas component off the shim (Task P5-x). |
| **Delete compat shims** | **ADOPT, incrementally** | The biggest renderer liability; three tiers of differing risk (Phases 1 + 5). |

---

## Phase map (execute in order; later phases assume earlier ones landed)

| Phase | Theme | Risk | Unblocks | Effort |
|---|---|---|---|---|
| **0** | Truth & guardrails: docs, lint guard, CI, CSP, ship identity | very low | safe iteration | S–M |
| **1** | Renderer correctness foundations: fix shim bugs, inline trivial shims | low | memoization, later de-shim | M |
| **2** | Git correctness: porcelain, watcher, streaming, liveness | low–med | a trustworthy app | M–L |
| **3** | Contracts registry + **Effect Schema + @effect/rpc** | med | type-safe boundary, Effect on-ramp | L |
| **4** | Collapse the triple-buffer to a single cache | med–high | clean renderer state, Effect renderer | XL |
| **5** | De-shim Tier 3 (Solid→idiomatic React) + StrictMode | high | idiomatic React, lint coverage | XL |
| **6** | **Effect in the domain layer** (sidecar Effect + `Stream` log) | med | the full Effect direction | L–XL |
| **7** | Structural polish (god-file split, graph worker, a11y, etc.) | low | maintainability | M |

Dependencies: 1 needs 0's lint guard. 4 needs 1 (identity fix) + 3 (registry). 5 needs 4. 6 needs 3
(Schema) + 4 (single cache). 7 is mostly independent and can be interleaved.

---

## Phase 0 — Truth & guardrails

Goal: stop the docs from lying, stop the shim from growing, make CI actually gate, and close the
cheap security/release holes. All independent; can be one stacked branch `phase-0-guardrails` with a
commit per task.

### P0-1 — Rewrite the architecture docs to match reality
**Findings:** arch/docs (HIGH), `Docs claim native fetch`; `Docs list deep links + getSidecarConfig`;
renderer/docs (MEDIUM) `SolidJS vs React`; testing/docs `SolidJS test suite`. **Effort S.**
**Files:** `CLAUDE.md`, `AGENTS.md`, `README.md` (cross-check).
**Change:** In both `CLAUDE.md` and `AGENTS.md`:
- Replace every "SolidJS / Kobalte / solid-query / solid-virtual" claim with **React 19 +
  `@tanstack/react-query` + `@tanstack/react-virtual`**.
- Replace "renderer reaches the sidecar via `sidecarFetch` (native fetch + Zod)" and any
  `getSidecarConfig` URL+token claim with the real flow: **renderer → IPC `sidecarRequest` → main →
  loopback HTTP → sidecar; the token never leaves main.**
- Delete the **deep-link** responsibility bullets (no protocol client/`open-url`/single-instance lock
  exists). If deep links are genuinely wanted later, that's Task P7-x.
- Add one line: *"`src/renderer/lib/*-compat.*` is a transitional SolidJS-shaped shim, scheduled for
  removal (see REMEDIATION_PLAN Phase 1/5). Do not add new imports from it."*
**Tests:** add a doc-guard test (Task P0-2) rather than a unit test here.
**Acceptance:** no occurrence of `SolidJS`, `getSidecarConfig`, or `native fetch` remains in
`CLAUDE.md`/`AGENTS.md`; `README.md` and `CLAUDE.md` agree on React 19.

### P0-2 — Doc-drift guard test + "no new react-compat" guard
**Findings:** same as P0-1 (prevent rot). **Effort S.**
**Files:** new `src/shared/__tests__/docs-guard.test.ts` (runs under `test:main`, node).
**Change:** a test that reads `CLAUDE.md` + `AGENTS.md` and asserts they do **not** contain
`/SolidJS/i`, `getSidecarConfig`, or `native fetch`. Add a second assertion that greps `src/renderer`
(excluding `lib/react-*-compat.*` and existing importers captured in a baseline list) for **new**
`react-*-compat` imports — simplest form: assert the count of files importing `*-compat` is `<=` a
hardcoded baseline number, so the count can only go down. Document the baseline.
**Acceptance:** test passes now; fails if someone reintroduces a banned doc term or grows the shim
import count.

### P0-3 — Wire e2e (and smoke) into CI; gate tests locally
**Findings:** testing (HIGH) `e2e never runs`; (MEDIUM) `test:smoke orphaned`; (MEDIUM) `pre-push runs
no tests`. **Effort S.**
**Files:** `.github/workflows/ci.yml`, `.githooks/pre-push`.
**Current:** `ci.yml` runs only `pnpm test:renderer` + `pnpm test:main`; the build job is named
"Build" and only greps the preload for `electronAPI`. `pre-push` runs only `typecheck` + `check`.
**Change:**
- In `ci.yml`, after the build step add `npx playwright install --with-deps chromium` then
  `pnpm test:e2e`. Add `pnpm test:smoke` (it consumes the existing `out/`). Rename the job to reflect
  it (e.g. "Build & integration").
- In `.githooks/pre-push`, add `echo "[pre-push] unit tests"` + `pnpm test:main` (fast, node). Leave
  the renderer suite out of pre-push if it's slow; CI covers it.
**Gotcha:** e2e launches the real binary — ensure the build artifact exists in the job before it runs.
**Acceptance:** CI shows an e2e + smoke step that actually executes; a deliberately broken IPC channel
name fails CI.

### P0-4 — Add a Content-Security-Policy
**Findings:** security (HIGH) `No CSP anywhere`. **Effort S.**
**Files:** `src/main/index.ts` (around window/session setup, lines ~49-110), `src/renderer/index.html`.
**Change:** In main, before loading the renderer, register
`session.defaultSession.webRequest.onHeadersReceived` and inject:
```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
```
(`'unsafe-inline'` for styles is required by Tailwind/shiki injected styles; revisit with nonces
later.) Add a matching `<meta http-equiv="Content-Security-Policy">` in `index.html` as
belt-and-suspenders. The renderer makes **no** outbound network calls (all sidecar traffic is IPC), so
`connect-src 'self'` is sufficient.
**Gotcha:** dev mode (`electron-vite dev`) uses an HMR websocket — scope the strict policy to packaged
builds, or add the dev server origin to `connect-src`/`script-src` only when `!app.isPackaged`, so HMR
still works.
**Tests:** e2e assertion that the app still loads and renders a repo; manually confirm no CSP
violations in the dev console.
**Acceptance:** Electron's security warning for missing CSP is gone; app loads in dev and packaged.

### P0-5 — Fix shipping identity and gate the updater
**Findings:** security/standards (HIGH) `placeholder identity, no signing`. **Effort M (config only).**
**Files:** `electron-builder.config.js`, `src/main/updater.ts`.
**Current:** `appId: 'com.example.git-gui'`, `productName: 'Git GUI'`,
`publish.owner: 'your-github-username'`, `repo: 'git-gui'`. The autoUpdater is wired and will poll a
dead feed in production.
**Change:** Set the real `appId` (e.g. `com.aahrix.rebase` — confirm with maintainer), `productName:
'Rebase'`, and the real `publish.owner`/`repo`. In `updater.ts`, gate `setupUpdater()` behind an env
flag / `app.isPackaged && process.env.REBASE_ENABLE_UPDATER === '1'` until a signed release feed
exists, so it doesn't poll a non-existent feed. Add `mac.hardenedRuntime: true` + entitlements +
notarize and Windows signing **only when** distributing (leave a TODO; out of scope to do now).
**Acceptance:** no `example.com`/`your-github-username` strings remain; updater does not fire in a
normal packaged run without the flag.

### P0-6 — Gate Inspect Element on `!app.isPackaged`
**Findings:** security/bug (MEDIUM) `Inspect Element gated on NODE_ENV (undefined in packaged main)`.
**Effort S.**
**Files:** `src/main/menu.ts:11`.
**Change:** Replace `showInspectElement: process.env.NODE_ENV !== 'production'` with
`showInspectElement: !app.isPackaged` (import `app` from `electron`). Matches `updater.ts` which
already uses `app.isPackaged`. Never read `process.env.NODE_ENV` in main-process runtime code.
**Tests:** main unit test if the function is pure-ish; otherwise rely on smoke + manual.
**Acceptance:** packaged build does not show Inspect Element.

### P0-7 — Align `@types/node` with `engines.node`
**Findings:** standards (LOW) `engines.node=24 but @types/node=25.8.0`. **Effort S.**
**Files:** `package.json`.
**Change:** Pin `@types/node` to the latest exact `24.x` (e.g. `24.x.y`) to match `engines.node: 24`.
**Acceptance:** `pnpm typecheck` green; majors in lockstep.

### P0-8 — Harden `electron-store` (schema + clearInvalidConfig)
**Findings:** security/smell (LOW) `electron-store no schema/clearInvalidConfig`. **Effort S.**
**Files:** `src/main/store.ts:20-49`.
**Change:** Pass a `schema` describing the persisted shape (`workspaces: string[]`, `activeWorkspace`,
`recentRepos`, `persistedTabRepoPaths`, `onboardingComplete`, sidebar prefs, etc.) and
`clearInvalidConfig: true` to `new Store(...)`, so a corrupt/tampered `config.json` resets to defaults
instead of throwing at startup.
**Tests:** main unit test: corrupt config object → store falls back to defaults (test the pure
migration/getter logic; don't mock Electron).
**Acceptance:** corrupt store file no longer crashes startup.

### P0-9 — Make the renderer test mock support arbitrary mutation ops
**Findings:** testing (HIGH) `useGitActions surface untested & unreachable through harness`. **Effort S.**
**Files:** `src/test/setup.ts:58-110`.
**Current:** the `electronAPI.sidecarRequest` mock **throws on unknown ops**, so any test touching an
unmocked mutation hits the throw first — this is why the entire `useGitActions` surface is untestable.
**Change:** Replace throw-on-unknown with a routable default: expose a `sidecarMock.respond(op,
handler)` registry and a fallback that returns `{ _tag: 'Ok' }` for unregistered ops (logging a warn
in CI only). Keep the explicit per-op overrides for tests that need specific tags.
**Acceptance:** `useGitActions` can be unit-tested (enables Task P2-7). Existing tests still pass.

### P0-10 — Add coverage tooling (advisory)
**Findings:** testing (LOW) `No coverage tooling`. **Effort S.**
**Files:** `package.json`, `vitest.config.ts`, `vitest.main.config.ts`.
**Change:** Add exact-pinned `@vitest/coverage-v8`; add a `test:coverage` script producing a report for
renderer+main. No hard thresholds yet (pre-alpha) — advisory only.
**Acceptance:** `pnpm test:coverage` emits a report; CI optionally uploads it.

---

## Phase 1 — Renderer correctness foundations

Goal: kill the **verified** shim defects and delete the trivial shims, **without** the big file-by-file
port (that's Phase 5). This recovers wasted CPU and makes `React.memo` usable. Branch
`phase-1-shim-foundations`.

> **Order matters within this phase:** do P1-1 (route the long-lived effect through refs) *before*
> P1-2 (createStore identity), because the `git.tsx:878-921` `[]`-deps subscription effect currently
> relies on `createStore` returning a *stable mutable object* to read live `state.repoPath`. Changing
> identity without first de-coupling that effect would turn a working accidental-invariant into a
> stale-closure bug.

### P1-1 — Make the long-lived IPC subscription effect depend on refs, not on mutable-object identity
**Findings:** state/race (LOW) `[]-deps effect captures first-render closures`; cross-cutting prep for
P1-2. **Effort S.**
**Files:** `src/renderer/stores/git.tsx:878-921` (the `onRepoChanged`/`onLogChunk` subscription
`useEffect([], …)`).
**Current:** the effect captures render-zero closures and reads `state.repoPath` live only because
`createStore` hands back one mutable object. Helpers it calls (`refreshWorkingTree`, restart helpers,
the `tabActive` accessor) are recreated each render.
**Change:** Introduce `const latest = useRef({ ... })` updated every render with the current helpers +
`state` reference, and have the subscription body read `latest.current.*`. This makes the invariant
explicit and survives P1-2's identity change.
**Tests:** extend `src/renderer/stores/__tests__/git.test.tsx` — fire an `onRepoChanged` after a
helper identity change and assert the latest helper runs.
**Acceptance:** subscription still reacts correctly after P1-2; `useExhaustiveDependencies` can later be
re-enabled for this effect.

### P1-2 — `createStore`: fresh object identity instead of in-place mutation
**Findings:** state/perf (HIGH) `createStore mutates one object`; cross-cutting (MEDIUM/HIGH duplicates).
**Effort S (the code) but verify call sites.**
**Files:** `src/renderer/lib/react-store-compat.ts:41-47`.
**Current:**
```ts
const replaceState = (next: T) => {
  if (Object.is(stateRef.current, next)) { return }
  Object.assign(stateRef.current, next)   // <-- identity never changes
  forceUpdate()
}
```
**Change:** `setPath`/`mergeIfChanged` already build a fresh object; stop discarding it:
```ts
const replaceState = (next: T) => {
  if (Object.is(stateRef.current, next)) { return }
  stateRef.current = next
  forceUpdate()
}
```
**Gotcha:** anything that captured `state` by reference and relied on live mutation breaks — P1-1
handles the main offender. Grep for other `state` captures in long-lived closures before shipping.
**Tests:** add a `react-store-compat.test.ts` (Task P1-5) asserting `state` identity **changes** when a
field changes, and is **stable** when an unchanged value is set.
**Acceptance:** `git.state` reference changes per update; existing renderer tests pass; manual smoke of
stage/commit/checkout shows no stale UI.

### P1-3 — Replace `createMemo` with real `useMemo` at the hot sites
**Findings:** compat/components/perf (HIGH ×3) `createMemo does no memoization`. **Effort M.**
**Files (hottest first):** `src/renderer/components/StatusPanel/VirtualFileList.tsx:55` &
`StatusPanel/index.tsx:35-37`; `src/renderer/components/shell/RefTreePanel.tsx:105-116` (+
`lib/ref-tree.ts:265-272`); `src/renderer/components/DiffPanel/index.tsx:84-139`;
`src/renderer/RepoPicker/RepoPicker.tsx:31-32`; `src/renderer/WorkspaceViews.tsx:129-152`.
**Current:** `createMemo(() => buildUnifiedFileRows(...))` recomputes every render.
**Change:** import `useMemo` from `react` and convert each to `useMemo(() => compute(...), [explicit,
deps])`. The inputs are already in scope (`props.status`, toggles, `query`, `hunks`). Where the call
site reads the memo as `rows()`, change to read the value directly.
**Gotcha:** these are the call sites most likely to also hit the *hooks-inside-`Show`/`For`* problem
(see P5). For now keep `Show`/`For` but lift the `useMemo` to the component body, never inside a
`Show`/`For` child callback.
**Tests:** a probe test (can live in `react-compat.test.ts`) asserting a `useMemo`-converted site does
**not** recompute when inputs are referentially stable (spy on the compute fn).
**Acceptance:** `pnpm test:renderer` green; the three big inputs (status rows, ref tree, diff merge)
recompute only when their inputs change.

### P1-4 — Inline and delete the three trivial shims
**Findings:** compat/state/testing (MEDIUM/LOW) `trivial shims are dead indirection`. **Effort S.**
**Files to delete:** `src/renderer/lib/react-virtual-compat.ts`, `react-dom-compat.tsx`,
`react-query-compat.ts`. **Call sites:** `main.tsx` (uses `render` from dom-compat); the 1 virtualizer
importer; the ~3 `createQuery`/`createMutation` importers (`stores/git.tsx`, hooks).
**Change:**
- `react-virtual-compat` → replace `createVirtualizer` with `useVirtualizer` from
  `@tanstack/react-virtual` at its one importer.
- `react-dom-compat` → in `main.tsx`, use `createRoot(rootElement).render(<QueryProvider><App/></…>)`
  directly (and this is where StrictMode will later wrap — see P5).
- `react-query-compat` → replace `createQuery(() => opts)` with `useQuery(opts)` and
  `createMutation(() => opts)` with `useMutation(opts)`; drop the thunk wrapper.
- Remove the three files; remove their entries from `biome.json` `overrides` (P1-6).
**Gotcha:** `react-query-compat`'s signature passes a thunk; `useQuery` takes the object — unwrap each
call. Keep `useQueryClient` re-exports working (import from `@tanstack/react-query`).
**Tests:** existing renderer tests cover these paths; ensure green.
**Acceptance:** the three files are gone; no imports reference them; typecheck/test green.

### P1-5 — Unit-test the remaining shim internals; delete dead shim exports
**Findings:** testing (MEDIUM) `shim has no direct tests`; compat (LOW) `dead exports inflate the shim`.
**Effort S.**
**Files:** new `src/renderer/lib/__tests__/react-store-compat.test.ts`,
`react-compat.test.ts`; edit `react-compat.tsx`.
**Change:**
- Delete unused exports from `react-compat.tsx`: `createDeferred`, `batch`, `on`, `createRoot`
  (no callers — grep to confirm). Drop the `hasHookDispatcher()` no-dispatcher fallback branches in
  `createSignal`/`createEffect`/`onMount`/`createMemo` (the app always runs inside a React tree); this
  removes ~120 lines and the React-internals probe.
- Add tests for the *kept* pure pieces: `setPath` (nested object + array, structural sharing via
  `Object.is`), `mergeIfChanged` (no-op when unchanged), `createSignal` setter short-circuit, `For` key
  derivation, and the P1-2 identity assertion.
**Gotcha:** confirm with grep that `createRoot`/`batch`/`on`/`createDeferred` truly have zero callers
before deleting.
**Acceptance:** `react-compat.tsx` shrinks substantially; the React-internals access is gone; new tests
pass.

### P1-6 — Re-enable lint where shims are fixed
**Findings:** arch (MEDIUM) `Biome carve-out disables hook rules renderer-wide`. **Effort S.**
**Files:** `biome.json:63-92`.
**Change:** Remove the override entries for the three deleted shims (P1-4). Keep the `react-compat.tsx`
override for now (Phase 5 removes it). Leave the `stores/git.tsx`
`useExhaustiveDependencies` override until Phase 4/5, but add a TODO referencing this plan.
**Acceptance:** `pnpm lint` green; the override block lists only files that still genuinely need it.

---

## Phase 2 — Git correctness (sidecar + watcher + streaming + liveness)

Goal: fix the real, user-visible defects. Branch per cluster (`phase-2-watcher`, `phase-2-streaming`,
`phase-2-sidecar`). These are mostly `test:main`/integration changes.

### P2-1 — Add `-z` to the two raw porcelain calls (quoted-filename corruption)
**Findings:** sidecar/bug (HIGH) + cross-cutting (LOW) `discardChanges/getDiff parse non-`-z`
porcelain`. **Effort S.**
**Files:** `src/sidecar/operations.ts:1091-1097` (`discardChanges` untracked detection) and `:338-341`
(`getDiff` `isUntracked`).
**Current:** `git status --porcelain` without `-z`, then `line.slice(3)` → on `core.quotepath` the path
comes back octal-escaped & double-quoted (`"caf\303\251.txt"`), never matching the unquoted relative
path → unicode/space/quote filenames misclassified (untracked file routed to `git restore` instead of
`git clean`; untracked unicode shows empty diff).
**Change:** add `-z` and split on NUL (`split('\0')`), dropping the fragile fixed `slice(3)` offset
(with `-z`, the format is `XY <path>\0`, so the path is `entry.slice(3)` of each NUL-delimited record —
but verify against `git`'s `-z` layout and handle the rename form `R old\0new\0`). Alternatively pass
`-c core.quotepath=false`. Prefer `-z` to match the rest of the codebase (`git/serialize.ts` already
does this).
**Tests:** `src/sidecar/__tests__/` integration test: create files named `café.txt` and `a b.txt`
(tracked + untracked), assert `discardChanges`/`getDiff` classify and act correctly. Include a renamed
file.
**Acceptance:** unicode/space/quoted filenames discard & diff correctly.

### P2-2 — Restart the log stream on external ref moves (stale commit graph)
**Findings:** transport/bug (HIGH) `External ref moves update labels but never restart log stream`;
cross-cutting (HIGH). **Effort M.**
**Files:** `src/renderer/stores/git.tsx:904-915` (the `onRepoChanged` handler, `kind==='refs'` branch),
relating to `:467-471` restart helper and `repoWatcher.ts:63-83`.
**Current:** `kind:'refs'` refreshes branch names/tracking only; `state.log` comes solely from the log
stream, restarted only by internal mutations → CLI `commit`/`rebase`/`amend`/external GUI leaves the
graph stale.
**Change:** in the `kind === 'refs'` handler, also `void restartLogStream(path)` alongside
`refreshBranchesOnly`. Coalesce with the existing debounce so a multi-step rebase doesn't restart per
ref write. Guard with the stream generation/seq (see P2-4) so it doesn't fight an internal mutation's
own restart already in flight.
**Tests:** renderer test: dispatch `onRepoChanged({kind:'refs'})` and assert a log-stream restart was
requested (and de-duped under rapid repeats).
**Acceptance:** committing from a terminal updates the in-app graph within the debounce window.

### P2-3 — Watch `.git/index` and resolve the real gitdir (CLI staging + worktrees)
**Findings:** transport/bug (MEDIUM ×2) `.git/index unwatched`; `.git assumed to be a directory`;
cross-cutting (MEDIUM). **Effort M.**
**Files:** `src/main/repoWatcher.ts:62-67` (`refsTargets` construction).
**Current:**
```ts
const gitDir = path.join(repoPath, '.git')
const refsTargets = [path.join(gitDir, 'HEAD'), path.join(gitDir, 'refs'), path.join(gitDir, 'packed-refs')]
```
This (a) never watches `.git/index`, so CLI `git add`/`reset`/`restore --staged` produce no status
refresh; (b) assumes `.git` is a directory — for linked worktrees/submodules `.git` is a *file* pointing
elsewhere, so refs are silently unwatched.
**Change:** resolve the real gitdir/common-dir once at watch start, in main, with a tiny helper
(`child_process.execFile('git', ['-C', repoPath, 'rev-parse', '--git-dir', '--git-common-dir'])` — no
`simple-git` needed). Watch `HEAD` under git-dir; `refs`/`packed-refs` under git-common-dir; add
`path.join(gitDir, 'index')`. Route `index` changes to a status refresh (a third drain that emits
`kind:'workingTree'` or a new `kind:'index'`; if you add a kind, update the shared `RepoChangeKind`
schema — see P2-6 — and the renderer handler).
**Gotcha:** `.git/index` churns more than refs — keep the 300ms debounce.
**Tests:** `repoWatcher.test.ts`: simulate a worktree layout (`.git` as a file) and assert refs targets
resolve; simulate an `index` touch and assert a status refresh emits.
**Acceptance:** CLI staging refreshes the status panel; branch switches in a worktree reflect in-app.

### P2-4 — Stamp log-stream chunks with a generation id (cancel-corruption)
**Findings:** cross-cutting/race (HIGH) `Log stream chunks carry no stream/generation id`. **Effort M.**
**Files:** `src/shared/schemas/git.ts:116-123` (LogChunk schema),
`src/main/ipc/log-stream.ts:27-36`, `src/renderer/stores/git.tsx:879-887` & `:517-520`.
**Current:** `restartLogStream` cancels then clears `logBuffer` and starts a new `git log`; in-flight
chunks from the old stream land in the freshly-cleared buffer (no way to tell them apart — same
`repoPath`, no generation) → duplicated/garbled rows, mixed revision ranges.
**Change:** add a monotonically increasing `streamId` to the start-log-stream request; echo it on every
`LogChunk` (schema + the main/sidecar relay). In `onLogChunk`, **drop** chunks whose `streamId` is not
the current one. The renderer already has `openGeneration.current` to seed/track the active id.
**Tests:** renderer test: start stream gen 1, enqueue a gen-1 chunk *after* a restart to gen 2, assert
the stale chunk is dropped and the buffer holds only gen-2 commits.
**Acceptance:** rapid restart (commit while a big log is streaming) never duplicates/garbles rows.

### P2-5 — Compute load-more `skip` from the authoritative buffer
**Findings:** cross-cutting/race (MEDIUM) `Load-more skip from throttled store length`. **Effort S.**
**Files:** `src/renderer/stores/git.tsx:552-558` (`loadMoreHistory`), `:883-887`.
**Current:** `--skip` derives from `state.log.all.length` (last *throttled* flush). If the initial
stream is still draining into `logBuffer.current`, the buffer holds more than the store → skip
re-requests buffered commits (dupes) or leaves a gap.
**Change:** compute skip from `Math.max(logBuffer.current.length, state.log?.all.length ?? 0)`, or track
an explicit `loadedCount` ref incremented as chunks arrive. Optionally force a synchronous flush before
computing skip.
**Tests:** renderer test reproducing the drain/scroll race; assert no duplicate or skipped commit.
**Acceptance:** pagination during an active stream produces a contiguous, dupe-free list.

### P2-6 — Route the `repo-changed` event through the shared channel + schema
**Findings:** contracts/bug (MEDIUM) `repo-changed bypasses Channel constant and its schema`. **Effort S.**
**Files:** `src/main/repoWatcher.ts:6,73`, `src/shared/schemas/git.ts:128-132`,
`src/preload/index.ts:65-68`, the store's `onRepoChanged`.
**Current:** the channel name is a magic string `'repo-changed'`; payload is an untyped literal never
run through `RepoChangedEventSchema`; `RepoChangeKind` is duplicated in `repoWatcher.ts` and the schema
(can drift); renderer trusts a preload cast.
**Change:** import `Channel.repoChanged` in `repoWatcher.ts`; build the payload via
`parseOrThrow(RepoChangedEventSchema, { repoPath, kind })` before `webContents.send`; delete the
duplicate `RepoChangeKind` and import the shared type; re-validate in preload or the store handler.
(If P2-3 added an `index` kind, add it to the schema here.)
**Tests:** main test: emit produces a schema-valid payload; an invalid kind throws at the boundary.
**Acceptance:** one source of truth for the channel name and the kind union.

### P2-7 — Centralize stash invalidation
**Findings:** state/bug (HIGH) `Stash list goes stale`; components (MEDIUM) `useStashes instantiated
twice`. **Effort S–M.** (depends on P0-9 for testability)
**Files:** `src/renderer/hooks/git/useStashes.ts:27-31`, `useGitActions.ts:165-175`,
`stores/git.tsx:904-915` (refresh paths), `Workspace.tsx`/`WorkspaceViews.tsx` (double instantiation).
**Current:** stash list refreshes only when a component remembers `.then(stashList.refetch)`; a
terminal stash (caught by the watcher) refreshes branches/status/diffs but leaves the stash panel
stale; `useStashes`/`useGitActions`/`useDialogs` are instantiated in **both** `Workspace` and
`LocalChangesView` (double dialog portals, double subscriptions).
**Change:** invalidate `stashKey(path)` inside the central refresh paths (`refreshWorkingTree` and the
`onRepoChanged` handler) and from the stash mutations in `useGitActions`; drop the manual `.then`
chains. Lift `useGitActions`/`useStashes`/`useDialogs` to a single `Workspace`-level instance (or a
small `WorkspaceContext`) and pass actions/refetch down to `LocalChangesView`.
**Tests:** with the P0-9 harness, `useGitActions.test.ts` asserting a stash mutation invalidates the
stash key; assert only one dialog portal mounts.
**Acceptance:** stash panel updates on terminal stash and on in-app stash; one dialog portal exists.

### P2-8 — Sidecar liveness + reconnect after crash
**Findings:** arch (HIGH) `No liveness monitoring/recovery when sidecar dies`. **Effort M.**
**Files:** `src/main/recovery.ts:108-112`, `src/main/sidecar.ts:98,108-127`, renderer error handling
(`stores/git.tsx:150`).
**Current:** on sidecar `child-process-gone` the only response is a log line; the renderer still thinks
repos are open; pending mutations reject opaquely; the next action lazily respawns an *empty* sidecar
with no re-open handshake.
**Change:** on `child-process-gone` matching the sidecar (by pid/serviceName), proactively respawn and
broadcast a `sidecar-restarted` event to all `webContents`. The renderer, on that event, re-opens its
known repos and restarts log streams, and shows a transient toast ("Reconnecting git engine…"). Keep
lazy respawn in `ensureSidecar` as fallback. Optionally add a lightweight periodic `/health` probe to
catch a hung-but-alive sidecar (the once-at-startup check can't).
**Gotcha:** coordinate with P2-10 (shutdown flag) so respawn doesn't race teardown.
**Tests:** main test of the recovery decision (pure logic in `recovery-decision.ts`); e2e is ideal but
hard to force-crash — at minimum unit-test the decision + the broadcast wiring shape.
**Acceptance:** killing the sidecar mid-session shows a reconnect toast and the repo recovers without a
manual reopen.

### P2-9 — Key `repoWatcher` by `${webContentsId}:${repoPath}` and unify path canonicalization
**Findings:** cross-cutting (LOW) `repoWatcher keyed by repoPath only`; arch/race (MEDIUM) `watcher and
log-stream keys derived in two processes`. **Effort S–M.**
**Files:** `src/main/repoWatcher.ts:17,53-60`, `src/main/ipc/repo.ts:14,20-24`,
`src/main/ipc/log-stream.ts`, `src/shared/repo-path.ts`.
**Change:** (a) key watchers by `` `${webContents.id}:${normalizeRepoPath(repoPath)}` `` mirroring
`log-stream.ts`, per the AGENTS.md isolation rule; (b) thread **one** canonical path — the sidecar's
`open` response path — into `startWatching`/`stopWatching`/`startLogStream` instead of re-normalizing in
main, so the watcher/log-stream/sidecar maps key off the same string.
**Tests:** main test: open→close with a **symlinked** repo path tears the watcher down (no leak).
**Acceptance:** no watcher leak on symlinked/worktree paths; keys consistent across maps; safe if a
second window is ever added.

### P2-10 — Sidecar shutdown flag + spawn timeout + don't-swallow errors + GIT_TERMINAL_PROMPT
**Findings:** sidecar (LOW) `no per-op timeout; hung git holds lock`; arch (LOW) `killSidecar races
ensureSidecar`; cross-cutting (LOW) `killSidecar double-spawn`; cross-cutting (LOW) `errors coerced to
500, message dropped`. **Effort M.**
**Files:** `src/main/sidecar.ts:102-127,202-205`, `src/sidecar/operations.ts:447-482,571-615`,
`src/sidecar/server.ts:682,716-722`.
**Change:**
- Add a module-level `isShuttingDown` flag set at the top of `killSidecar`, checked in
  `ensureSidecar`/`startSidecar` so they refuse to spawn during shutdown (reject in-flight instead).
  Capture/await the in-flight `startup` promise (or a generation token the spawn `.then` checks) so a
  late spawn can't publish an orphaned child.
- Add a timeout to the spawn helpers (kill child + reject after N seconds, releasing the repo lock) and
  consider `server.requestTimeout`.
- Pass `GIT_TERMINAL_PROMPT=0` to the `simpleGit()` instances (env at creation), so commit/stage/checkout
  get the prompt-hang mitigation the raw-spawn paths already have.
- In `server.ts` catch blocks, `console.error` the real error (already piped to main) instead of
  dropping it into a bare 500; optionally include a non-sensitive class/message in dev builds.
**Tests:** sidecar tests for timeout (a hanging fake git rejects + releases the lock); main test for the
shutdown flag.
**Acceptance:** a hung git op times out and frees the lock; no double-spawn on quit; 500s are logged.

### P2-11 — Scope the fetch lock; don't serialize mutations behind a network fetch
**Findings:** sidecar/perf (MEDIUM) `fetchRepo holds the write lock for the whole network fetch`.
**Effort S.** **Contestable — confirm intent.**
**Files:** `src/sidecar/operations.ts:622-629,571-615`, `repo-lock.ts`.
**Change:** drop `withRepoLock` around `fetchRepo` and rely on the existing fetch-semaphore (a fetch
writes only remote-tracking refs, which don't conflict with index/worktree mutations). If you want
fetch to block destructive ops, scope the lock to just the ref-updating window, not the whole network
call. Acquire the semaphore **before** any lock so a skip returns immediately.
**Tests:** sidecar test: a slow fetch does not block a concurrent commit/checkout.
**Acceptance:** a long fetch no longer queues the user's commit for the full round-trip.

---

## Phase 3 — Contracts registry + Effect Schema + `@effect/rpc` (Effect enters)

Goal: replace the stringly-typed `op` + hand-paired response schema + unvalidated request bodies with a
**single typed registry**, and migrate the shared wire contracts from **Zod → Effect Schema**, using
**`@effect/rpc`** as the registry. This is the audit's #1 architecture fix *and* the natural Effect
on-ramp. Branch `phase-3-effect-contracts`. Keep TanStack Query as the renderer cache (do **not** drop
it here).

> **Why here, not earlier:** the op→schema registry is schema-library-agnostic and delivers most of the
> type-safety win; doing it as the Effect entry means Effect lands on a boundary that's *already* being
> reshaped, not on top of the Solid shim. Per §0.3 this is the committed Effect direction.

### P3-0 — Add Effect dependencies (exact-pinned)
**Effort S.** **Files:** `package.json`, lockfile.
**Change:** add, at exact versions (run `pnpm view <pkg> version` and pin — no `^`):
- `effect` (core: `Effect`, `Schema`, `Stream`, `Data`, `Either`, `Option`, `Cause`, `Exit`,
  `ManagedRuntime`). Schema is exported from `effect` directly (`import { Schema } from 'effect'`).
- `@effect/platform` + `@effect/platform-node` (HTTP client/server abstractions for the sidecar; Node
  layer for main+sidecar).
- `@effect/rpc` (+ its HTTP transport/serialization packages — **verify the exact package split for the
  pinned version**, e.g. `RpcSerialization` lives in `@effect/rpc`; HTTP transport composes with
  `@effect/platform`'s `HttpClient`/`HttpRouter`).
- `@effect/vitest` (dev) for `it.effect` test helpers.
**Gotcha:** Effect packages are pure JS — no `pnpm.onlyBuiltDependencies` entry needed. They ship ESM;
confirm `electron-vite`/`tsconfig` `moduleResolution: bundler|nodenext` resolves them in main, sidecar,
and renderer. Effect's API surface evolves between minors — **treat every Effect code sketch in this
plan as illustrative and verify against the installed version.**
**Acceptance:** `pnpm typecheck` green with a trivial `Effect.succeed(1)` smoke import in each process.

### P3-1 — Build the op → {request, response} registry (still on Zod first, optional)
**Findings:** contracts (HIGH) `No op→schema registry`; (MEDIUM) `sidecar never schema-validates request
bodies`; sidecar (MEDIUM) `dispatch() is 460 lines of copy-paste guards`. **Effort L.**
**Files:** `src/shared/sidecar-ops.ts` (extend), `src/shared/schemas/ipc.ts`,
`src/renderer/lib/sidecar-fetch.ts`, `src/sidecar/server.ts` (`dispatch`), new
`src/shared/sidecar-registry.ts`.
**Current:** `op` is a bare string; the request body shape, the op, and the response schema are three
independent facts paired by hand at each call site (`sidecar-fetch.ts:6-13`); request bodies arrive as
`Record<string, unknown>` and are re-validated by ad-hoc `typeof`/`requiredString` ~30× in
`server.ts`; a missing op falls to a 404 default.
**Change:** define one registry keyed by `SidecarOpName`:
```ts
// illustrative shape — implement with Effect Schema in P3-2, or Zod now then swap
export const sidecarRegistry = {
  [SidecarOp.getStatus]: { request: GetStatusRequest, response: StatusResponseSchema },
  [SidecarOp.stageFile]: { request: StageFileRequest, response: StageResponseSchema },
  // ...every op, including the file-array params that must run through resolveRepoRelativeFile
} as const
```
Make `sidecarFetch` take **only** the op and infer body+return types from the registry (overload or
generic lookup). Have the sidecar `dispatch` import the same request schemas and **parse the body once
per op** before the handler. Collapse `dispatch` to a declarative op-table driver: each entry declares
required string params, file-array params (auto-run through `resolveRepoRelativeFile`), response schema,
and handler — a single generic dispatcher enforces repo-resolution and file-resolution uniformly, making
it structurally impossible to skip a path guard (kills the `invalidRepoPath` duplication and the
path-traversal footgun).
**Gotcha:** the *output* side validates server-authored constants today — once inputs are validated at
the boundary, trust typed constructors for outputs (drop `parseOrThrow` on statically-built responses)
to cut hot-path work. Wire `LogStreamRequestSchema`'s bounds into the actual `/stream/log` handler
(they're silently unenforced today).
**Tests:** `src/sidecar/__tests__/server.test.ts` — unknown op → typed error not a bare 404; a malformed
body → schema rejection; every `SidecarOp` has a registry entry (table-driven test).
**Acceptance:** adding an op without a registry entry fails typecheck/test; request bodies are validated
centrally; `dispatch` is a table + small driver.

### P3-2 — Migrate shared schemas Zod → Effect Schema
**Findings:** contracts (STRATEGIC) `Zod→Effect Schema assessment`; (LOW) `parseOrThrow loses structured
issue path`; (LOW) `GitStatusSchema.files optional but load-bearing`. **Effort XL (mechanical).**
**Files:** `src/shared/codec.ts`, `src/shared/schemas/git.ts`, `schemas/ipc.ts`, `schemas/log-stream.ts`,
`channels.ts` consumers; every `z.infer` type import across the three processes.
**Why it maps cleanly:** the layer already uses `_tag` discriminated unions, a single codec chokepoint
(`parseOrThrow`), and infers all types from schemas — Effect `Schema.Union` of `Schema.TaggedStruct`s is
a near 1:1 target; `parseOrThrow` collapses to `Schema.decodeUnknownSync`.
**Change (mechanical, illustrative):**
```ts
// before (Zod)
const gitError = z.object({ _tag: z.literal('GitError'), message: z.string() })
export const StatusResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), status: GitStatusSchema }), repoNotOpen, gitError])
export type StatusResponse = z.infer<typeof StatusResponseSchema>

// after (Effect Schema)
const GitError = Schema.TaggedStruct('GitError', { message: Schema.String })
export const StatusResponse = Schema.Union(
  Schema.TaggedStruct('Ok', { status: GitStatus }), RepoNotOpen, GitError)
export type StatusResponse = typeof StatusResponse.Type
```
Rewrite `codec.ts`:
```ts
import { Schema, Either } from 'effect'
export function parseOrThrow<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  return Schema.decodeUnknownSync(schema)(value)   // throws ParseError with a structured tree
}
// add a non-throwing variant for telemetry:
export const parseEither = <A, I>(schema: Schema.Schema<A, I>) =>
  Schema.decodeUnknownEither(schema)
```
Fixes the "opaque string error" finding for free (Effect `ParseError` carries a structured tree —
distinguish contract-drift from operational errors at call sites). While here, make
`GitStatusSchema.files` **required** (or `Schema.optionalWith(..., { default: () => [] })`) since the
unified-changes list depends on it — stop the silent `?? []` degradation.
**Gotcha:** `z.record(...).optional()` partial-record semantics need `Schema.Record` +
`Schema.optionalWith`; verify the `remotes`/`tracking` shapes. Do this op-cluster by op-cluster, keeping
the app green between clusters (the registry from P3-1 localizes the blast radius). Remove `zod` from
`package.json` only after the **last** `z.` import is gone (grep to confirm).
**Tests:** port `src/shared/__tests__/codec.test.ts` to Effect Schema; round-trip decode/encode tests for
each response union; a contract-drift test asserting a bad payload yields a structured `ParseError`.
**Acceptance:** no `zod` import remains in `src/shared`; all three processes typecheck against
`Schema.Type`; `pnpm test:main` green.

### P3-3 — Express the registry as an `@effect/rpc` group (typed transport over IPC)
**Findings:** contracts (HIGH) registry, continued. **Effort L.**
**Files:** new `src/shared/rpc.ts` (the `RpcGroup`), `src/sidecar/server.ts` (serve the group),
`src/main/sidecar.ts` / `src/main/ipc/settings.ts` (forward), `src/renderer/lib/sidecar-fetch.ts`
(client).
**Change:** define each op as an `Rpc` with a Schema request, a Schema success, and **tagged error**
types (`RepoNotOpen`, `GitError`, `Conflict`, `HunkNotFound`, `FetchSkipped`, `NotARepo`) instead of
`_tag` unions carried in the success payload — Effect's RPC models the error channel natively:
```ts
// illustrative — verify @effect/rpc API for the pinned version
class GetStatus extends Rpc.make('getStatus', {
  payload: { repoPath: Schema.String },
  success: GitStatus,
  error: Schema.Union(RepoNotOpen, GitError),
}) {}
export const SidecarRpcs = RpcGroup.make(GetStatus, /* ... */)
```
Serve the group from the sidecar HTTP server; keep the renderer→IPC→main→HTTP transport (the RPC client
runs in **main**, the renderer calls it over IPC exactly as today — `sidecarFetch` becomes a thin typed
IPC caller whose types come from `SidecarRpcs`). **Do not** move the RPC client into the renderer (it
has no network; §0.1).
**Gotcha:** this is the riskiest part of Phase 3 — the `@effect/rpc` transport API has changed across
versions. Spike one op end-to-end (`getStatus`) behind the existing tests before converting all ops.
Keep `parseOrThrow`-based `sidecarFetch` working for un-migrated ops during the transition.
**Tests:** e2e: `getStatus` over the real IPC→HTTP path returns a decoded result; a `RepoNotOpen` flows
as a typed error, not a thrown string.
**Acceptance:** at least the read ops go through the RPC group with typed errors end-to-end; the
stringly-typed `op` + manual schema pairing is gone from migrated call sites.

---

## Phase 4 — Collapse the triple-buffer to a single source of truth

Goal: stop hand-syncing **three** caches (TanStack Query + `createStore` mirror + module-level snapshot
`Map`). This is the dominant source of `stores/git.tsx`'s 1052 lines and a prerequisite for both an
idiomatic-React renderer (Phase 5) and an Effect renderer. Branch `phase-4-single-cache`. **Highest-risk
phase — do it behind the existing `git.test.tsx` behavioral tests and add more first.**

**Findings:** state (HIGH) `Server state triple-buffered`; (MEDIUM) `Mutations bypass Query's optimistic
lifecycle`; (MEDIUM) `Query keys inconsistently scoped`; (LOW) `mergeBranches reference-equality no-op`;
components (HIGH) `createStore multiplies renders`.

### P4-1 — Lock current behavior with tests
**Effort M.** Add renderer tests pinning the externally-observable behavior of `useGitStore`/`git.tsx`:
open→status→branches→log, optimistic stage/unstage, commit refresh selection, error toasts per tag,
load-more. These are the safety net for the refactor.

### P4-2 — Make TanStack Query the single cache
**Effort XL.** **Files:** `src/renderer/stores/git.tsx`, `lib/query-keys.ts`,
`lib/repo-snapshot-cache.ts`, `providers/QueryProvider.tsx`, all consumers reading `git.state.*`.
**Change:**
- Read git data in components via `useQuery`/`select` instead of mirroring into `createStore`. Status,
  branches, log live **only** in the Query cache.
- Replace `repo-snapshot-cache` with Query's own persistence (`initialData`/`placeholderData` seeded
  from the cache, or a small persister) — stop dual-writing a snapshot `Map` on every refresh.
- Keep a *small* store **only** for imperative UI-action flags (`opening`/`committing`/`pushing`/
  `pulling`); stop storing `status`/`branches`/`log` there.
- Adopt Query's optimistic lifecycle for mutations: `onMutate` (optimistic `setQueryData` + snapshot
  context), `onError` (rollback), `onSettled` (invalidate), and a `mutationKey` per `(op, file)` to
  serialize concurrent same-file stage/unstage (closes the interleave gap). Make `applyHunkMutation`
  consistent.
- Unify query-key scoping: given one-tab-per-repo, **key everything by `repoPath` alone** (drop `tabId`
  from `repoQueryKeys`) so query cache, (removed) snapshot, and stash key partition identically and a
  reopened repo reuses the warm cache. Delete the `mergeBranches` reference-equality guard (it never
  fires — arrays are freshly allocated upstream) or make it a real value comparison.
**Gotcha:** the log stream is push-based (IPC chunks), not a normal query — keep it imperative but write
its result into the Query cache (`setQueryData(logKey, …)`) so there's still one source of truth. The
P2-4 generation id makes this safe.
**Tests:** P4-1 suite must stay green; add a test asserting `git` state object identity is no longer
load-bearing (no component relies on a stable mutable `state`).
**Acceptance:** no `repo-snapshot-cache`; `createStore` holds only UI flags (or is gone — see P5);
mutations use Query's optimistic lifecycle; `stores/git.tsx` materially smaller.

---

## Phase 5 — De-shim Tier 3 (Solid → idiomatic React) + StrictMode gate

Goal: remove the rest of the SolidJS dialect (`createSignal`/`createEffect`/`createMemo`/`Show`/`For`/
`splitProps`/`JSX.*`), delete `react-compat.tsx` + `react-store-compat.ts`, re-enable hook lint, and wrap
the tree in `<StrictMode>`. Branch family `phase-5-deshim-*`, **one branch per directory** so each is
independently reviewable and testable.

**Findings:** compat/components (HIGH/XL) `shim freezes Solid dialect`, `63/82 files depend on it`;
(MEDIUM) `For keys by index`, `hooks inside Show/For`, `createStore breaks memo`; (LOW) `JSX namespace
duplication`, `Solid-style let refs`, `StrictMode masks bugs`.

### P5-1 — Port components off the shim, directory by directory
**Effort XL.** Mechanical mapping, applied per file (use the per-directory test suites as the gate):
| Solid idiom | React replacement |
|---|---|
| `createSignal(x)` → `value()` / `setValue(v)` | `useState(x)` → `value` / `setValue` (drop the accessor call) |
| `createMemo(fn)` | `useMemo(fn, [deps])` (explicit deps) |
| `createEffect(fn)` / `onMount(fn)` | `useEffect(fn, [deps])` / `useEffect(fn, [])` |
| `onCleanup(fn)` | return `fn` from the `useEffect` |
| `Show when={c} fallback={f}` | `{c ? children : f}` or a thin typed `Show` taking children directly (no accessor) |
| `For each={xs}` | `xs.map((item) => <Row key={stableKey(item)} … />)` — **explicit content-derived key**, never index |
| `splitProps(props, keys)` | destructuring (`const { a, b, ...rest } = props`) |
| `JSX.Element` return types | `React.ReactNode` / `ReactElement` (drop the shim `JSX` namespace; keep `react-env.d.ts` for the `--css-var` CSSProperties augmentation) |
| Solid `let el` + ref callback | `useRef<T>(null)` + a normal effect with real deps |

Suggested order (low→high blast radius): `components/ui/*` → `RefTreeRow/*` → `StatusPanel/*` →
`OnboardingScreen/*` → `RepoPicker/*` → `HistoryPanel/*` (incl. the canvas component, P5-2) →
`shell/*` → top-level (`App.tsx`, `Workspace*.tsx`, `TabView`, `RepoTab`, `NewTab`). Convert
`stores/git.tsx`'s remaining `createSignal`/`createStore` to `useState`/`useReducer` or
`useSyncExternalStore` (after Phase 4 it holds only UI flags, so this is small).
**Gotcha (the dangerous one):** today some `createSignal`/`useQuery` calls happen **inside `Show`/`For`
child callbacks** — a Rules-of-Hooks violation that only survives by accident. When porting, lift all
hook calls to component bodies; render dynamic lists as real keyed components, never hooks-in-`map`.
Fix the `For` index-keying as you go (content-derived keys).
**Tests:** the existing per-directory `__tests__` suites are the gate; keep each green per file. Re-enable
`eslint-plugin-react-hooks`-equivalent Biome rules per directory as you finish it.
**Acceptance per directory:** no `react-compat` import remains in that directory; its tests pass; Biome
hook rules are on for it.

### P5-2 — Port the commit-graph canvas component off the shim (no SVG rewrite)
**Findings:** graph (MEDIUM) `Solid shim makes canvas redraw work by accident`; (LOW) `dead scrollTop
prop`; `useGraphLayoutWorker` misnomer. **Effort M.**
**Files:** `src/renderer/components/HistoryPanel/CommitGraphCanvas.tsx`,
`src/renderer/hooks/useGraphLayoutWorker.ts`.
**Change:** convert to idiomatic React — `useRef` for the canvas and the rAF id; **one** `useEffect`
whose dep array lists the props that actually affect drawing (`rows`, `viewportHeight`, `visibleSet`,
`railWidth`, `startIndex`, `endIndex`, `graphLayoutEndIndex`, `themeNonce`). Delete the dead `scrollTop`
prop (the draw already reads `scroller.scrollTop`). Rename `useGraphLayoutWorker` → `useGraphLayout`
(there is **no** worker; layout runs sync on the main thread). **Keep Canvas** (see §0.7).
**Acceptance:** the canvas redraws on explicit deps (not every render); `scrollTop` prop gone; hook name
honest.

### P5-3 — Delete `react-compat.tsx` + `react-store-compat.ts`, enable StrictMode
**Effort M.** Once P5-1/P5-2 land and no file imports the shim: delete both files, remove the last
`biome.json` overrides, and wrap the root in `<StrictMode>` in `main.tsx`. Fix whatever double-invoke
surfaces (it should be nothing if the port is clean).
**Acceptance (definition-of-done for the de-shim):** zero `*-compat` imports remain; `<StrictMode>` is on
and the app passes; `pnpm lint` has full hook coverage; `pnpm test:renderer` + `pnpm test:e2e` green.

---

## Phase 6 — Effect in the domain layer (sidecar Effect + `Stream` log)

Goal: now that contracts are Effect Schema (Phase 3) and the renderer is clean (Phases 4–5), adopt
Effect *the effect system* where it earns its keep: the sidecar git operations (typed error channel,
interruption, resource safety) and the log stream (`Stream`). Branch `phase-6-effect-domain`.

**Findings:** state (STRATEGIC) `Effect/Stream would simplify the log-stream + ordered-status state
machines`; sidecar `clean primitives worth keeping` (wrap, don't rewrite).

### P6-1 — Model sidecar git operations as `Effect`
**Effort L.** **Files:** `src/sidecar/operations.ts`, `src/sidecar/git/*`, `src/sidecar/server.ts`.
**Change:** convert op handlers to return `Effect.Effect<Success, GitError | RepoNotOpen | …, …>`:
- Wrap `simple-git`/spawn calls in `Effect.tryPromise` mapping rejections to **tagged errors**
  (`Data.TaggedError`), replacing the `try/catch` + `_tag` construction.
- Express `withRepoLock`/`fetch-semaphore` as Effect resources (`Effect.acquireRelease` / a
  `Semaphore`) so the lock is released on interruption/timeout (closes P2-10's "lock held on hang" more
  cleanly). **Keep the existing primitives' behavior** — wrap, don't rewrite the proven backpressure
  logic.
- Run the op via `ManagedRuntime` at the HTTP boundary in `server.ts`; map the typed error channel onto
  the `@effect/rpc` error responses from P3-3 (the mapping is now 1:1).
- Add the per-op timeout as `Effect.timeout` (replaces the manual kill-after-N from P2-10).
**Gotcha:** the sidecar is a hot path — benchmark a read op (`getStatus`) before/after to confirm Effect
overhead is negligible at this granularity. Migrate op-cluster by op-cluster; keep un-migrated ops on
the existing path.
**Tests:** port `src/sidecar/__tests__/*` to `@effect/vitest` `it.effect`; assert typed errors and lock
release on interruption/timeout.
**Acceptance:** migrated ops return Effects with a typed error channel; lock always releases; tests green.

### P6-2 — Model the log stream as an Effect `Stream`
**Effort L.** **Files:** `src/sidecar/log-stream.ts`, `src/main/ipc/log-stream.ts`,
`src/renderer/stores/git.tsx` (consumer), `src/shared/schemas/log-stream.ts`.
**Change:** represent the `git log` NDJSON stream as a `Stream` of decoded `LogChunk`s carrying the P2-4
generation id; interruption (`restartLogStream`) becomes `Stream` interruption (clean cancellation,
no in-flight-chunk corruption by construction). Keep NDJSON-over-HTTP on the wire (do **not** switch to
websockets — §0.7); Effect models the *consumer/producer* state machine, not the transport. The renderer
consumes via the existing IPC bridge, folding chunks into the Query cache (Phase 4).
**Tests:** stream interruption mid-flight yields no stale chunks (the Effect equivalent of P2-4's test).
**Acceptance:** log streaming runs as an interruptible `Stream`; restart-during-stream is correct by
construction.

### P6-3 — (Optional) Effect at the renderer query boundary
**Effort M.** **Contestable — decide after P6-1/2.** Keep TanStack Query as the cache; run Effects inside
`queryFn`/`mutationFn` via a renderer `ManagedRuntime` (`Effect.runPromise`). Do **not** drop
react-query for a hand-rolled Effect cache — the audit's one firm caution. Revisit only if a concrete
need (cross-query coordination, ret[ry/schedule policies) appears.
**Acceptance:** if adopted, queries call Effects through one runtime; react-query still owns caching.

---

## Phase 7 — Structural polish (interleave anytime after Phase 2)

Independent, lower-priority. One branch per item.

- **P7-1 — Split `operations.ts` (1126 LOC).** Extract one shared `spawnGit(args, opts) →
  {code,stdout,stderr}` (folding `runGit`/`runFetch`/`runGitCommand`, dedupe the 4096-byte stderr cap),
  then split along the `git/` seams (branches, stash, working-tree/diff, sync). *(sidecar LOW)*
- **P7-2 — Single-instance lock.** `app.requestSingleInstanceLock()` in `whenReady`; focus the existing
  window on second-instance. Closes the persisted-state race; prerequisite if deep links are ever added.
  *(arch LOW)*
- **P7-3 — Graph layout: measure then decide.** Benchmark `layoutCommits` on a 10k-commit log; if
  >~8ms, move it to a Web Worker / OffscreenCanvas (it has no DOM deps); else just keep the P5-2 rename
  and stop allocating two arrays per row. Make the extend-branch immutable (`rows = prev.rows.slice()`).
  *(graph/perf LOW)*
- **P7-4 — Selector caches → `WeakMap`.** Replace the single-slot module-global caches in
  `HistoryPanel/selectors.ts` with `WeakMap<GitLogEntry[], CommitIndex>` so two open repos each keep
  their index (multi-tab safe; auto-evicts). *(graph/perf MEDIUM/LOW)*
- **P7-5 — Perf test that actually exercises width.** Add a fan-out history fixture (200–400 interleaved
  branches across 10k commits) to `layout.perf.test.ts` so the O(commits×lanes) path is guarded; keep
  the linear case. Optionally replace linear lane scans with a `Map<hash, laneIndex>` + free-lane set.
  *(perf MEDIUM)*
- **P7-6 — Octopus-merge test + scaled merge-dot.** Add a 3-parent layout+draw test asserting distinct
  lanes + drawn edges; re-examine the `parentSet.has(outgoing[j])` guard at `canvas.ts:151`; derive
  merge-dot radius/stroke from `ROOT_PX`. *(graph LOW)*
- **P7-7 — Graph a11y decision.** Keep the canvas `aria-hidden`, but expose topology cheaply in the DOM
  row (parent count / "on branch X" visually-hidden hint); lean on the ring-vs-fill merge distinction
  for color-blindness rather than more palette entries. *(graph LOW)*
- **P7-8 — `--` end-of-options on ref commands.** Append `--` to `checkout`/`reset`/`merge` ref args so a
  ref can't be reinterpreted as a pathspec (defense-in-depth atop the leading-dash guard). *(sidecar LOW)*
- **P7-9 — Capability detection via typed tag, not string match.** Replace the
  `'invalid sidecar request'` substring match in `fetchLocalBranches`/`fetchRemoteRefs` with a typed
  `UnknownOp` result / capabilities handshake (folds naturally into the Phase 3 registry). *(state LOW)*
- **P7-10 — `commitGraphWritten` lifetime + `scan-root-registry` removal.** Clear `commitGraphWritten`
  on `closeRepo` (or document once-per-process); delete the dead `scan-root-registry.ts` store/take
  round-trip and use the validated `scanRoot` local directly. *(sidecar LOW)*
- **P7-11 — Read/write lock for index-affecting reads.** Optional read-write lock so a status read can't
  observe a half-applied hunk-stage (removes a one-frame flicker) without serializing all reads.
  *(cross-cutting LOW)*
- **P7-12 — Constant-time token compare + uniform OPTIONS.** `crypto.timingSafeEqual` over equal-length
  buffers; move OPTIONS after auth. Hygiene only (loopback + per-spawn UUID already makes this
  practically unexploitable) — do not over-invest. *(security LOW)*
- **P7-13 — Auto-fetch timer.** Drop `fetchTick` from the auto-fetch effect deps (or document the
  reset-on-manual-fetch intent) so manual fetches don't indefinitely postpone the 5-minute cadence.
  *(transport/cross-cutting LOW)*
- **P7-14 — `DiffPanel` (optional).** Leave its size as-is (cohesive); optionally extract pure helpers
  (`remapHunk`, `HUNK_RANGE_RE`, the `HunkEntry`/`PendingHunk` types) to `diff-merge.ts` for isolated
  unit tests. Do **not** split for size. *(components LOW)*

---

## Appendix A — Full findings index (all 101 → task)

Severity counts: **20 high, 28 medium, 47 low, 6 strategic.** Every finding maps to a task below. (Line
numbers are from the audit snapshot and drift as code changes — each task re-locates by description.)

| Dim | Sev | Finding (short) | Task |
|---|---|---|---|
| arch | HIGH | docs claim native fetch; actually IPC-tunneled | P0-1 |
| arch | HIGH | no liveness/recovery when sidecar dies | P2-8 |
| arch | MED | migration shim reaches React private internals | P1-5 / P5 |
| arch | MED | watcher & log-stream keys derived in two processes | P2-9 |
| arch | MED | docs list deep links + getSidecarConfig (nonexistent) | P0-1 |
| arch | LOW | no single-instance lock | P7-2 |
| arch | LOW | killSidecar races ensureSidecar | P2-10 |
| arch | LOW | token compare non-constant-time; OPTIONS bypass | P7-12 |
| sidecar | HIGH | discardChanges/getDiff parse non-`-z` porcelain | P2-1 |
| sidecar | STRAT | validate inputs, trust constructed outputs | P3-1 |
| sidecar | MED | fetchRepo holds write lock for whole fetch | P2-11 |
| sidecar | MED | dispatch() 460 lines copy-paste guards | P3-1 |
| sidecar | LOW | ref commands lack `--` separator | P7-8 |
| sidecar | LOW | commitGraphWritten lifetime mismatch | P7-10 |
| sidecar | LOW | pushRepo hardcodes origin/HEAD | P7 (note) |
| sidecar | LOW | scan-root-registry dead indirection | P7-10 |
| sidecar | LOW | operations.ts 1126-LOC god-file | P7-1 |
| sidecar | LOW | no per-op timeout; hung git holds lock | P2-10 |
| sidecar | LOW | clean primitives — keep as-is | (none; do not change) |
| state | HIGH | server state triple-buffered | P4-2 |
| state | HIGH | stash list goes stale | P2-7 |
| state | STRAT | Effect/Stream would help — fix triple-buffer first | P4 / P6 |
| state | MED | query keys inconsistently scoped | P4-2 |
| state | MED | SolidJS shims dead-weight indirection | P1-4 / P5 |
| state | MED | mutations bypass Query optimistic lifecycle | P4-2 |
| state | LOW | []-deps effect captures first-render closures | P1-1 |
| state | LOW | mergeBranches reference-equality no-op | P4-2 |
| state | LOW | capability fallback via string match | P7-9 |
| compat | HIGH | createMemo does no memoization | P1-3 |
| compat | HIGH | createEffect/onMount no deps — fire every render | P1-3 / P5 |
| compat | HIGH | shim freezes codebase in Solid dialect | P5 |
| compat | MED | createStore mutates one object — breaks memo | P1-2 |
| compat | MED | For keys by index | P5-1 |
| compat | LOW | dead exports inflate shim | P1-5 |
| compat | LOW | Solid-style let refs instead of useRef | P5-1 |
| compat | LOW | JSX namespace duplicated | P5-1 |
| components | HIGH | createMemo zero memoization (diff/ref-tree) | P1-3 |
| components | HIGH | createStore in-place mutation multiplies renders | P1-2 / P4-2 |
| components | HIGH | shim leftover — 63/82 tsx depend on it | P5 |
| components | MED | createSignal/createMemo inside Show/For (hooks landmine) | P5-1 |
| components | MED | docs claim SolidJS — React 19 | P0-1 |
| components | MED | useGitActions/useStashes/useDialogs instantiated twice | P2-7 |
| components | LOW | App.tsx computes 'loaded' twice | P5-1 (tidy) |
| components | LOW | no StrictMode masks shim bugs | P5-3 |
| components | LOW | DiffPanel dense but cohesive — keep | P7-14 |
| components | LOW | tab/workspace model is clean — keep | (none) |
| graph | HIGH | useGraphLayoutWorker not a worker (sync) | P5-2 / P7-3 |
| graph | STRAT | Canvas is right — do NOT switch to SVG | (decided: keep) |
| graph | MED | shim makes canvas redraw work by accident | P5-2 |
| graph | MED | selectors module-level caches not multi-tab safe | P7-4 |
| graph | LOW | dead scrollTop prop; themeNonce implicit | P5-2 |
| graph | LOW | octopus-merge edges can be dropped; untested | P7-6 |
| graph | LOW | rail has no accessible representation | P7-7 |
| contracts | HIGH | no op→schema registry | P3-1 |
| contracts | STRAT | Zod→Effect Schema assessment | P3-2 |
| contracts | MED | sidecar never schema-validates request bodies | P3-1 |
| contracts | MED | repo-changed bypasses Channel + schema | P2-6 |
| contracts | LOW | GitStatusSchema.files optional but load-bearing | P3-2 |
| contracts | LOW | parseOrThrow loses structured issue path | P3-2 |
| transport | HIGH | external ref moves never restart log stream | P2-2 |
| transport | STRAT | AGAINST websockets/SSE — IPC is the push channel | (decided: reject) |
| transport | MED | `.git/index` unwatched (CLI staging) | P2-3 |
| transport | MED | `.git` assumed a directory (worktrees) | P2-3 |
| transport | LOW | change→refresh latency floor ~400ms | (accept) |
| transport | LOW | auto-fetch timer resets on manual fetch | P7-13 |
| transport | LOW | react-query-compat near-dead indirection | P1-4 |
| perf | HIGH | createMemo shim no memoization (all sites) | P1-3 |
| perf | MED | useGraphLayoutWorker sync on main thread | P5-2 / P7-3 |
| perf | MED | layout perf test guards only linear chain | P7-5 |
| perf | LOW | selector caches single-slot globals | P7-4 |
| perf | LOW | virtualItems() recomputed 3×/render | P7 (optional) |
| perf | LOW | buildUnifiedFileRows re-sorts every render | P1-3 (memo fixes most) |
| testing | HIGH | e2e exists but never runs in CI | P0-3 |
| testing | HIGH | useGitActions mutation surface untested | P0-9 / P2-7 |
| testing | STRAT | delete shim via targeted refactors, not big-bang | P1 / P5 |
| testing | MED | test:smoke orphaned | P0-3 |
| testing | MED | pre-push runs no tests | P0-3 |
| testing | MED | shim layer has no direct tests | P1-5 |
| testing | LOW | no coverage tooling | P0-10 |
| testing | LOW | docs describe SolidJS test suite | P0-1 |
| security | HIGH | no CSP anywhere | P0-4 |
| security | HIGH | placeholder identity, no signing | P0-5 |
| security | MED | docs claim deep links (nonexistent) | P0-1 |
| security | MED | Inspect Element gated on NODE_ENV (undefined) | P0-6 |
| security | LOW | @types/node 25 vs engines.node 24 | P0-7 |
| security | LOW | token non-constant-time compare | P7-12 |
| security | LOW | native-fetch doc claim wrong (IPC is GOOD, keep) | P0-1 |
| security | LOW | electron-store no schema/clearInvalidConfig | P0-8 |
| security | LOW | dispatch trusts forwarded body keys | P3-1 |
| cross | HIGH | log chunks carry no generation id | P2-4 |
| cross | MED | load-more skip from throttled length | P2-5 |
| cross | MED | createStore in-place mutation defeats memo | P1-2 |
| cross | LOW | repoWatcher keyed by repoPath only | P2-9 |
| cross | LOW | discardChanges slice(3) misclassifies | P2-1 |
| cross | LOW | status reads bypass withRepoLock (flicker) | P7-11 |
| cross | LOW | layoutCommits mutates prev rows in place | P7-3 |
| cross | LOW | killSidecar double-spawn | P2-10 |
| cross | LOW | auto-fetch timer resets on manual fetch | P7-13 |
| cross | LOW | sidecar errors coerced to 500, message dropped | P2-10 |

## Appendix B — Validation command matrix

| Change touches | Run |
|---|---|
| anything | `pnpm typecheck && pnpm check && pnpm lint` |
| `src/renderer/**` | `pnpm test:renderer` |
| `src/main/**`, `src/shared/**` | `pnpm test:main` |
| IPC / cross-process / startup | `pnpm build && pnpm test:smoke && pnpm test:e2e` |
| deps changed | `pnpm install` + confirm exact versions, no `^`/`~` |
| docs (`CLAUDE.md`/`AGENTS.md`) | `pnpm test:main` (doc-guard, P0-2) |

## Appendix C — Effect package reference (pin exact versions)

| Package | Use | Notes |
|---|---|---|
| `effect` | `Effect`, `Schema`, `Stream`, `Data`, `Either`, `Option`, `ManagedRuntime` | Schema is `import { Schema } from 'effect'`; pure JS, no build script |
| `@effect/platform` | HTTP client/server abstractions | sidecar serve + main client |
| `@effect/platform-node` | Node layer | main + sidecar |
| `@effect/rpc` (+ transport/serialization) | op→request/response registry with tagged errors | **verify package split for the pinned version**; spike one op first |
| `@effect/vitest` (dev) | `it.effect` test helpers | for sidecar/contract tests |

All Effect packages are ESM and pure JS — exact-pin (`pkg@x.y.z`, no `^`), no `pnpm.onlyBuiltDependencies`
entry needed. Effect's API moves between minors: **treat every Effect snippet in this plan as
illustrative and verify against the installed version before relying on it.**

## Appendix D — Definition-of-done gates

- **Phase 1 done:** `createStore` identity changes per update; `createMemo` hot sites use real
  `useMemo`; 3 trivial shims deleted; shim tests pass; `pnpm test:renderer` green.
- **Phase 2 done:** unicode-filename discard/diff correct; CLI commit/stage/worktree changes reflect
  in-app; no log corruption on restart; sidecar crash recovers with a toast.
- **Phase 3 done:** every op has a registry entry (typecheck-enforced); request bodies validated
  centrally; `src/shared` has zero `zod` imports; at least the read ops flow through `@effect/rpc` with
  typed errors end-to-end.
- **Phase 4 done:** no `repo-snapshot-cache`; the `createStore` mirror holds only UI flags (or is gone);
  mutations use Query's optimistic lifecycle; `stores/git.tsx` materially smaller; P4-1 tests green.
- **Phase 5 done:** zero `*-compat` imports; `<StrictMode>` on and passing; Biome hook rules fully on;
  `pnpm test:renderer` + `pnpm test:e2e` green.
- **Phase 6 done:** migrated sidecar ops return Effects with a typed error channel; the lock always
  releases on interruption/timeout; the log stream is an interruptible `Stream`; react-query still owns
  renderer caching.
