# Rebase-Git

Rebase is a fast Git client for developers working on large repositories. It runs as an Electron app on Linux, macOS and Windows, or as a local server that the user opens in the browser with one command, including inside WSL without installing the Windows app. Each machine runs one server that sees its repositories; later a client will connect to several servers over the internet. There are no users yet, so anything can change.

## How we build

- Build complex things as simply as possible. KISS and YAGNI: build only what the task needs. No speculative layers, ports, options, variants, negotiation or future-proofing nobody asked for.
- A change lands in few places. A new repository command touches its contract, one server Git function and its `command(...)` entry, the web code that calls and shows it, and its tests. When a feature needs more places than that, fix the design instead of adding glue.
- One concept, one folder per app: `src/contracts/<concept>`, `src/apps/server/features/<concept>`, `src/apps/web/features/<concept>`. A concept's types, validation, failure messages, storage, hooks and components live in its folder, not in `domain/`, `persistence/`, `hooks/`, `components/` or a sibling feature. Slice web features by what the user sees, not by Git verb.
- A second kind of something (tag next to branch, pull next to fetch) extends the first through a discriminated union or a descriptor. Never copy a hook, component or file per kind.
- Start a feature in one file. Split a file past about 300 lines by responsibility. Do not create a file under about 60 lines unless two features import it. Add a subfolder only for a sub-responsibility with several files, never by file kind, and never a folder with one file.
- Prefer deep modules: few files with real behavior behind small interfaces. No `index.ts` barrels, no file that only re-exports, no hook or component that only wraps one call for one caller, no type-only `*.contract.ts` next to its implementation.
- Extract a function when it is reused or worth testing on its own, and keep it in the same file. The caller should read as a sequence of steps.
- Name files for what they hold (`conflict-document.ts`, `use-merge-document.ts`), never `model`, `utils`, `helpers` or `types`.
- Use package names across packages and the private aliases `#server/*`, `#web/*`, `#desktop/*` inside one. No relative imports.
- No code comments.

## Architecture

- Declare every route once in `src/contracts` with the `route`, `repositoryQuery` and `repositoryCommand` builders. A route answers `{ _tag: "Ok", value }` or `{ _tag: "Rejected", failure }`. Domain failures are plain tagged structs in the route's failure union, created as wire values; no intermediate error classes. Transport statuses belong to transport and authorization only.
- A server feature is a list of `command(route, policy, handler)` and `query(route, handler)` entries plus Git functions. `command` owns worktree validation, locking and the standard `RepositoryRejected` failures.
- Server code uses Effect for Git processes, streams, cancellation, concurrency and resource lifetimes. Build dependencies once at the entry point as plain objects and pass them as arguments; add a Context service only when two live implementations exist. Run Effects at entry points and adapt Promise or callback libraries once, including cancellation and cleanup.
- Server SQLite goes through Drizzle: query the tables directly, no repositories, generate migrations with Drizzle Kit.
- Web server state lives in TanStack Query: read with `useEnvironmentQuery(route, input)`, write with `useCommand(route)`, freshness from the `EnvironmentChanged` bridge. A feature never writes the query cache by hand and never adds its own cache, controller, store, provider, transport client or error class. Effect runs in the web only in the environment connection and the history worker.
- Commit history is local-first: the server streams every commit into the browser's IndexedDB and the graph reads only from there. Scopes, ordering, lanes and search run in the browser; the graph never asks the server for rows.
- A feature owns its UI end to end and plugs into the workspace; features never talk to each other through counter or request props. Keep rendering, focus and interaction state in React with plain props; add a context only when props would cross several levels.
- Failure wording, confirmations and toolbar buttons come from shared primitives.
- Every action is reachable by keyboard with standard accessible interaction. Buttons, menus and keys for one action call the same handler.
- No tooltips anywhere, including native `title`. Use `aria-label` or visible text and show explanations and feedback inline.

## Performance

Speed is non-negotiable; if it is not fast it is bad. A click shows something happening immediately. Design for repositories with hundreds of thousands of commits, many worktrees and remote servers. Judge latency by client–server round trips per click.

Run performance benchmarks only on local development machines, never in CI, including scheduled and manual workflows. Timing budgets live in the local benchmark suite; functional CI tests may use bounded waits only to detect hangs.

## Cross-platform

- Build, packaging and release scripts are native Linux, macOS and Windows code. A Linux build proves nothing about Windows.
- Node cannot run `.cmd` or `.bat` shims with `execFile` or `spawn` without a shell. On Windows call them through `process.env.ComSpec ?? "cmd.exe"` with `/d /c`, or run a native binary. Pass release values through the child-process `env` option, arguments separately.
- A subprocess added, removed or reordered in a packaging path must run on Windows in the validation matrix before the release workflow uses it. `pnpm build:web` and the npm package smoke test do not cover `pnpm build:desktop-package`.
- Paths can contain spaces and non-ASCII characters. Pass them as separate process arguments, never inside a shell string.
- Before restoring code removed by a `fix(...)` commit, learn why it was removed and keep the fixed invariant.

## Tests

- Code deleted, tests deleted. Do not test every scenario.
- Each risk has one owning layer; test it at the lowest layer that proves it and do not assert it again elsewhere.
  - Unit: server and domain logic in isolation with typed fakes. No infrastructure internals, cancellation, epochs, write ordering or fiber lifetimes; test the result the caller sees.
  - Integration: one real boundary such as Git, SQLite, the filesystem, a process, IPC, browser storage or the network.
  - UI: real UI in a browser with typed fake clients; owns component states, accessibility, focus, keyboard, pointer and error handling.
  - E2E: a few successful user journeys across real runtimes. Each names its goal and the boundary chain a lower layer cannot prove.
  - Release smoke: the produced artifact installs or launches and reports its identity.
- Typed fakes and test data builders live once in `tests/support`; do not write full contract literals in test files. Production code has no option, export or attribute that only tests use.
- Wait for conditions, never durations: poll or subscribe for the observable outcome and let the shared timeouts in `vitest.config.ts` and the Playwright configs be the only bound. No sleeps, private timers or per-test timeouts. In product code a duration is only a deadline that detects a hang, never pacing; bursts go through a queue that the consumer drains when free.
- A test that fails intermittently is a bug. Never rerun a pipeline to get green; find the cause and fix it.
- Windows:
  - Git and process spawns cost 10 to 100 times more than on Linux. Build large repository states with `fastImport` from `#tests-support/git` and keep Git invocations per test to a handful.
  - Create every non-bare fixture repository, including clones, through `#tests-support/git` so `core.autocrlf` is off. Never compare checkout contents with a literal unless the fixture guarantees LF.
  - Remove temporary directories with `removeTemporaryDirectory` from `#tests-support/temporary-directory`; Windows cannot delete files that Git, SQLite or Electron still hold open.
  - Fixture file names contain no `"`, `:`, `*`, `?`, `<`, `>`, `|` or trailing spaces and dots. Skip a case on `win32` only when it tests a name Windows cannot create.
  - Watchers deliver late `change` events for directory timestamps. Treat a `change` on a directory that has its own watcher as noise unless the adapter filters it.

## Process

- Editing this file requires Alex's explicit permission.
- Do not create documentation files without Alex's approval.
- Investigate whether a problem can be solved without a script before writing one.
- Source lives in `src/`, tests in `tests/`.
