# Agent Instructions

Single source of truth for agents in this repo. `CLAUDE.md` imports this file — edit this one.

## What this is

**Rebase** is a Git client built with TypeScript, React 19, Electron, and Effect. Version 0.0.2 is a
transition from the original Electron/sidecar architecture to a separately runnable Web, Server,
and leaf Agent architecture. The legacy desktop path is still production code while features move
slice by slice. Do not confuse coexistence with the desired end state, and do not refactor legacy
code unless the task requires it.

Users stage and commit constantly, so Git and filesystem work must never block a UI, Electron, or
Server event loop. Native work belongs in a leaf Agent in the new architecture and in the legacy
sidecar only for slices that have not migrated yet.

## Commands

```bash
pnpm dev                  # legacy Electron desktop development
pnpm dev:web              # browser runtime
pnpm dev:server           # rebuild standalone Server on changes
pnpm dev:agent            # rebuild standalone Agent on changes
pnpm build                # Electron + Web + Server + Agent → out/
pnpm package              # electron-builder; :mac / :win / :linux for one target

pnpm typecheck
pnpm check                # Biome format + lint verification
pnpm check:fix            # Biome autofix

pnpm test:renderer        # Web/renderer UI and state
pnpm test:main            # legacy Electron main
pnpm test:main:integration
pnpm test:sidecar         # legacy sidecar and real-Git integration
pnpm test:server          # new Server contracts and process integration
pnpm test:agent           # new Agent contracts and process integration
pnpm test:smoke           # builds, launches the binary, checks for startup errors
pnpm test:e2e             # playwright against the real built app
pnpm test:ci
```

Single test: `pnpm vitest run <file>` with the matching `vitest.*.config.ts`, or
`pnpm playwright test <file>` for E2E.

Demo recording for PR bodies: `REBASE_DEMO=1 pnpm playwright test <file>` runs any e2e spec
slowed down with video capture on, writing `.webm` files to `test-results/demos/`. On Windows use
`$env:REBASE_DEMO='1'; pnpm playwright test <file>` (PowerShell). Record demos by driving the
feature's own e2e spec — don't add bespoke capture scripts.

Linux E2E runs use a private Xvfb display so Electron windows cannot steal desktop focus. Set
`REBASE_E2E_USE_DESKTOP=1` only for interactive debugging against the active display.

A `pre-push` hook runs `pnpm typecheck` and `pnpm check`; `pnpm install` wires it up.

## Architecture

### Target runtimes

- `src/agent/` — the leaf native runtime for exactly one Environment. It owns system Git,
  filesystem/process resources, repository sessions, and native observation. It never owns an
  Environment registry, routing target, browser session, or a way to launch/connect to another
  Agent. Its executable composition root is `src/agent/index.ts`.
- `src/server/` — orchestration, Environment ownership, Agent connection/liveness, authentication,
  retry policy, command certainty, and Browser-facing routing. It does not execute Git or absorb
  Agent implementation details. Its composition root is `src/server/index.ts`.
- `src/web/` and `src/renderer/` — the browser runtime and React UI. UI code is organized as domain
  feature slices. Browser code has no Node access and speaks to the Server through typed contracts.
- `src/common/features/` — wire facts shared by new runtimes: Effect Schemas, serialized request and
  response shapes, RPC declarations, protocol constants, and definitive peer-owned failures. It is
  not a home for workflows, routing, retry, lifecycle, UI state, Server interpretation, or Agent
  implementation.

### Transitional legacy runtimes

- `src/electron/`, `src/main/`, and `src/preload/` compose the current desktop application.
- `src/sidecar/` remains the current desktop Git runtime for slices that have not migrated.
- `src/shared/` contains legacy desktop/sidecar contracts. Do not add new Agent/Server architecture
  there.

The packaged desktop intentionally continues to start the legacy sidecar until a vertical feature
slice replaces that path. Preserve this behavior unless the issue explicitly removes it. New
architecture work must not import legacy sidecar, Electron, Main, Preload, Renderer, or legacy
`src/shared/` implementation.

### Dependency direction

```text
Web/Renderer -> Server-facing contracts
Server       -> Common Agent contracts
Agent        -> Common Agent contracts
Common       -> no runtime implementation

Electron/Main/Preload -> legacy Shared contracts -> legacy Sidecar
```

Agent never imports Server. Server never imports Agent implementation. Common never imports any
runtime. A feature should not reach into another feature's internals; depend on its public `index.ts`
or move a genuinely shared wire fact to Common.

### Feature folders

Organize production code by domain capability:

```text
src/<runtime>/features/<feature>/
  index.ts
  <cohesive-capability>/
  <cohesive-workflow>.ts
```

Feature folders may contain several meaningful subfolders and separate contracts, functions, and
models when that improves locality. Do not impose a global `functions/`, `models/`, `contracts/`, or
`shared/` taxonomy. Group files that change together and name folders after the capability they own,
such as `session`, `transport`, `git`, or `repository-observation`.

Avoid both extremes: no giant catch-all files, and no one-file directory or one-function file that
adds navigation without isolating a real concern. `index.ts` exposes the small feature interface; it
does not contain the implementation.

Names must state responsibility. Bare names such as `bootstrap.ts`, `commands.ts`,
`compatibility.ts`, `events.ts`, `rpc.ts`, and `protocol.ts` are usually evidence that unrelated
concerns were grouped together. Qualify the name with the owned workflow or split the module.

### Common versus runtime ownership

Put something in Common only when it must be serialized unchanged between runtimes. A schema being
useful to two modules is not enough if the concept belongs to one runtime.

- Agent owns definitive execution results, native paths, process behavior, and repository state.
- Server owns dispatch certainty, `NotDispatched`/`OutcomeUnknown`, refresh policy, retry,
  reconnection, routing, and Environment identity.
- Web owns presentation and browser interaction state.
- Common owns only the wire representation they agree to exchange.

When uncertain, keep behavior in the runtime that decides it. Promote only the smallest stable wire
fact, never an implementation convenience.

### Effect 4 boundary

New Agent/Server architecture uses the exact `effect4` dependency. Legacy Effect 3 code may remain
until its slice migrates; do not mix Effect versions within one new feature.

- Plain deterministic transformations, comparisons, parsing, and state transitions stay plain
  TypeScript.
- Async workflows, I/O, clocks, timeouts, retries, interruption, concurrency, and resource lifetime
  use Effect.
- Resources use `Scope`, `Layer`, and acquire/release semantics. Do not coordinate ownership with
  loose timers, mutable flags, or per-call runtimes.
- Keep typed failures through the module interface. Translate adapter failures once at the owning
  feature seam.
- Run Effect once at each executable composition root. Do not erase Effect into Promise inside
  feature implementation.
- Wrap Node or platform APIs in one small adapter when Effect 4 does not provide the required
  integration.

## Rules

- **Feature ownership first.** Code lives with the runtime and capability that owns the decision.
  Do not place feature-specific code in Common, Shared, `lib`, or another generic dumping ground.
- **SOLID with restraint.** Give modules one reason to change, keep dependency direction explicit,
  and hide complex implementation behind a small interface. Do not manufacture interfaces or
  classes for hypothetical substitution.
- **KISS.** Use the smallest design that preserves the real invariant. A design pattern must solve
  an existing ownership, lifecycle, or variation problem.
- **DRY knowledge, not syntax.** Centralize protocol constraints and domain decisions. Similar code
  in two runtimes may remain separate when the runtimes own different policy.
- **Prefer deep modules.** Callers and tests use the same small interface. Avoid pass-through layers,
  wrapper classes, and abstractions whose only purpose is making tests easier.
- **Never block an event loop on Git.** New native work stays in Agent. Unmigrated desktop work stays
  in the legacy sidecar.
- **Every behavior change ships with tests** at the matching interface or process boundary.
- **Exact dependency versions**, no `^` or `~`: we review every version that lands. Add with
  `pnpm add package@1.2.3`. Postinstall scripts are restricted via `allowBuilds` in
  `pnpm-workspace.yaml`.
- **No speculative abstractions or heavy dependencies.** Add them only for a demonstrated need.
- Preserve unrelated user changes and avoid broad legacy cleanup during a feature migration.

## Testing boundaries

- All new tests, fixtures, fakes, proxies, and harnesses live under top-level `tests/`, never inside
  `src/`. Existing legacy `src/**/__tests__` can remain until that slice migrates, but do not add to
  them for new architecture.
- Mirror feature ownership under `tests/<feature>/` and test through the same production interface
  callers use.
- Do not add production classes, methods, flags, endpoints, or dependency injection solely for
  tests. A seam belongs in production only when production has real variation or ownership to hide.
- Pure state transitions can have focused tests. Authentication, process lifecycle, cancellation,
  backpressure, reconnection, and command certainty require real-process or adapter-boundary tests.
- Compatibility fixtures are append-only. A required peer behavior change creates a new protocol
  version and fixture; never rewrite a published fixture.
- Test code must not enter runtime bundles. Keep architecture and bundle-isolation guards green.

## Style

Biome enforces the mechanics — run `pnpm check:fix` before committing. Beyond that:

- **Always brace** `if`/`else`/`for`/`while`/`do`, even one-liners.
- **Descriptive names.** No `r`, `g`, `ps`, `vh` — write `result`, `git`, `parents`,
  `viewportHeight`. Short names are fine for loop indices, event params, and unused bindings.
- **Never write comments.** Not to explain WHAT, not to explain WHY, not as a JSDoc/TSDoc block, not
  as a section divider, not as a `TODO`. This codebase has none and gains none. Carry the meaning in
  the code instead: name things descriptively, split the function, encode the constraint in a type,
  or say it in the PR description. If a line seems to need a comment to be understood, rewrite the
  line. The only exception is a directive the compiler or linter actually reads — `biome-ignore`,
  `@ts-expect-error`, `@vitest-environment` — which must carry the terse reason those tools require
  and nothing more.
- shadcn components live in `src/renderer/components/ui/`.

## Pull requests

PRs are squash-merged into `main`, so the PR title becomes the commit message — it follows
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Commit freely on the branch.

Issues and external PRs live in this repo's GitHub Issues (`gh` CLI). Triage labels: `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Domain notes go in `CONTEXT.md`.

## Agent skills

### Issue tracker

Issues and PRDs live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, used unchanged: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
