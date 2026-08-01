# Agent Instructions

Single source of truth for agents in this repo. `CLAUDE.md` imports this file — edit this one.

## What this is

**Rebase** — a desktop Git GUI: Electron + React 19 + TypeScript + Tailwind, `pnpm` as package
manager. Users open repos, stage files, and commit hundreds of times a day, so the app has to feel
fast: Git runs in a forked sidecar process and the main thread never blocks on it.

## Commands

```bash
pnpm dev                  # electron-vite dev (hot reload)
pnpm build                # → out/
pnpm package              # electron-builder; :mac / :win / :linux for one target

pnpm typecheck
pnpm check:fix            # biome format + lint, autofix

pnpm test:renderer        # components, hooks, UI state (happy-dom)
pnpm test:main            # store, pure logic (node)
pnpm test:sidecar         # sidecar logic + real-git integration (node)
pnpm test:smoke           # builds, launches the binary, checks for startup errors
pnpm test:e2e             # playwright against the real built app
pnpm test:ci              # renderer + main + sidecar + e2e
```

Single test: `pnpm vitest run <file>` (add `--config vitest.main.config.ts` or
`vitest.sidecar.config.ts` for those layers), `pnpm playwright test <file>` for e2e.

Demo recording for PR bodies: `REBASE_DEMO=1 pnpm playwright test <file>` runs any e2e spec
slowed down with video capture on, writing `.webm` files to `test-results/demos/`. Record demos
by driving the feature's own e2e spec — don't add bespoke capture scripts.

A `pre-push` hook runs `pnpm typecheck` and `pnpm check`; `pnpm install` wires it up.

## Architecture

Four processes, hard boundary between them:

- `src/main/` — Electron main. Windows, dialogs, menu, updater, `electron-store`, and the sidecar's
  lifecycle. Proxies Git IPC to the sidecar. **No Git logic.**
  - `app/` window + app chrome (menu, updater, CSP, shutdown), `ipc/` channel handlers,
    `sidecar/` process spawn + lifecycle + RPC + crash recovery, `repo/` filesystem watching,
    `store/` `electron-store` schema and migrations.
- `src/sidecar/` — forked `utilityProcess` HTTP server on loopback. Owns all `simple-git` work.
  - `server/` HTTP + protocol + RPC handlers, `session/` per-repo sessions, locks and semaphores,
    `git/` process spawning and Git primitives, `operations/` the Git operations themselves,
    `test-support/` fixtures shared by tests.
- `src/preload/` — `contextBridge` bridge exposing `window.electronAPI`. Context isolation is on;
  the renderer has no Node access, and the sidecar's URL and token never leave main + sidecar.
- `src/renderer/` — React 19 UI. Git through @tanstack/react-query + typed `callSidecarRpc` helpers;
  @tanstack/react-virtual for long lists.
  - `app/` bootstrap, tabs and workspace composition; `shell/` app chrome (Shell, Sidebar, Topbar,
    Titlebar, RepoRail); `features/<slice>/` one folder per domain slice — `history`, `status`,
    `diff`, `commit`, `refs`, `repos`, `onboarding`, `sync` — each owning its components, its
    `store.tsx`, and its own pure logic; `components/ui/` shadcn primitives; `lib/` and `hooks/`
    for genuinely cross-cutting code only; `stores/` for cross-slice state.

`src/shared/` holds the Effect Schema contracts all of them speak.

A feature slice may import from `lib/`, `hooks/`, `stores/`, `components/ui/` and `shared/`. Prefer
not to reach across slices — if two slices need the same thing, it belongs one level up.

The renderer supports N tabs, each holding a different repo, so every Git call carries a `repoPath` —
there's no implicit "current repo" anywhere below the UI. One tab per repo is an enforced invariant.

## Rules

- **Never block the main thread on Git.** It stays in the sidecar.
- **Every behaviour change ships with tests**, at the layer that matches it (see the table above).
  Don't mock `BrowserWindow`/`ipcMain` or unit-test Electron boilerplate — E2E and smoke cover those.
- **Exact dependency versions**, no `^` or `~`: we review every version that lands. Add with
  `pnpm add package@1.2.3`. Postinstall scripts are restricted via `allowBuilds` in
  `pnpm-workspace.yaml` — only listed packages run them.
- **Don't add abstractions or heavy dependencies** that aren't solving a real problem.

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
