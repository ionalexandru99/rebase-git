# Rebase-Git

Rebase is an electron application meant to create the easiest and fastest UI/UX experience for developers to work on their projects.

The application is currently in development with no users.

## Environments

The app should be able to work on multiple operating systems:
- linux
- macos
- windows

For Windows we expect the application to work also on WSL.

The application should also be able to connect to any remote environment via SSH and communicate the repository changes without any issues.

### Cross-platform scripts

- Treat build, packaging, and release scripts as native Linux, macOS, and Windows code. A successful Linux build does not prove that a script works on Windows.
- Node cannot execute `.cmd` or `.bat` shims directly with `execFile` or `spawn` without a shell. On Windows, invoke the shim through `process.env.ComSpec ?? "cmd.exe"` with `/d /c`, or execute a native binary instead. Pass release values through the child-process `env` option and keep command arguments separate from those values.
- When a change adds, removes, or reorders a subprocess in a cross-platform packaging path, the validation matrix must run that exact command on Windows before the release workflow uses it. `pnpm build:web` and an npm package smoke test do not cover `pnpm build:desktop-package`.
- Before restoring code removed by a `fix(...)` commit, inspect why it was removed. Preserve the fixed invariant even when the newer feature needs a different implementation.

### Cross-platform tests

- Windows runs Git and process-heavy tests several times slower than Linux. Rely on the shared project timeouts in `vitest.config.ts` and the Playwright configs; do not add per-test timeouts to pass on a slower runner.
- Remove temporary directories with `removeTemporaryDirectory` from `#tests-support/temporary-directory`. Windows cannot delete or replace a file that Git, SQLite, or Electron still holds open, even briefly after the process closes.
- Windows file watchers deliver late `change` notifications for directory timestamps, including writes made before the watcher started. Treat a `change` on a directory that has its own watcher as noise, and do not assert that a watcher never reports an unrelated change kind unless the adapter filters that noise.
- Fixture file names must be valid on Windows: no `"`, `:`, `*`, `?`, `<`, `>`, `|`, or trailing spaces and dots. Skip a case on `win32` only when it tests a name that Windows cannot create.
- Paths can contain spaces and non-ASCII characters. Pass them as separate process arguments, never inside a shell string.
- Windows file operations and process spawns cost 10 to 100 times more than on Linux. A test that writes hundreds of files or spawns dozens of Git processes exceeds the shared budget there even when it takes 200 ms on Linux. Build large repository states with `fastImport` from `#tests-support/git` and keep Git invocations per test to a handful.
- Create every fixture repository, including clones, through the helpers in `#tests-support/git` so `core.autocrlf` is off. Never compare a checkout's file contents with a literal unless the fixture guarantees LF.
- A test that fails intermittently is a bug. Do not rerun the pipeline to get green; find the cause (timing budget, watcher timing, shared state, ordering, platform) and fix it in the same PR or a dedicated one. Wait for conditions, never for durations: poll or subscribe for the observable outcome and let the shared project timeout be the only upper bound. No sleeps, private timers or per-call timeouts in tests or product code.

## Performance

Performance is one of the corner stones of the application. Speed is the non negotiable aspect of the app. If it is not fast it is bad.
Everything should feel smooth, with as little lag as possible, regardless of the means of interacting with the repository, it being direct in the file system, or via SSH.
Commits should load on the computer without input lag and the app should react fast.
Pressing on a button should show something happening as fast as possible, not wait.

Run performance benchmarks only on local development machines. Do not run them in CI pipelines, including scheduled and manually triggered workflows. Keep timing budgets in the local benchmark suite; functional CI tests may use bounded waits to detect hangs.

## Userbase

Currently there are no users so changes can be done easily without any worries.
The main audience we have are developers working on huge codebases.
We want to be sure that we handle with care complex scenarios like:
- repositories with thousands of commits in history
- repositories with multiple worktrees
- repositories operating on different environment

The user should be able to run the Rebase system on their computer without the need of installing the app using the browser and running the server on their machine via a command.
A user on WSl should not be required to install the electron app on windows and connect to wsl if they don't want to, or need to. Running a command should be able to start the server and open the browser so that the user can access the app from there.

## General code requirements

- Editing `AGENTS.md` requires Alex's explicit permission. Never add, remove, or change its instructions without that permission.
- Never create documentation files unless Alex explicitly approves their creation.
- We want the code to be as simple as possible, easy to extend
- Use workspace package names for cross-package imports. Within a package, use its configured private aliases such as `#server/*`, `#web/*`, `#web-ui/*`, and `#desktop/*` for implementation imports. Do not use relative imports in source or tests, and do not expose implementation wildcards through package `exports` solely to resolve internal modules.
- Declare every HTTP route once in `src/contracts` with the `route`, `repositoryQuery` and `repositoryCommand` builders. A route answers `{ _tag: "Ok", value }` or `{ _tag: "Rejected", failure }` at HTTP 200. Domain failures are plain tagged structs in the route's failure union; never wrap them in error classes or map them to HTTP statuses. Real HTTP statuses belong to transport and authorization only. Keep other contracts in `*.contract.ts` files only at real boundaries: worker messages, persistence, and a feature's public entry point.
- A server feature is a list of `command(route, policy, handler)` and `query(route, handler)` entries plus Git functions. `command` owns worktree validation, locking and the standard `RepositoryRejected` failures; a handler returns the success value or fails with a wire failure.
- Keep business modules under `features/<feature-name>`. Keep `domain` and `persistence` as sibling top-level layers outside `features`.
- Give each feature an explicit public entry point and a small root containing its main composition module and public contracts. Put supporting UI in `components/` and React hooks in `hooks/`; group other implementation code by responsibility when needed. Create only folders that have useful contents. Keep internal imports on private aliases and exports explicit.
- Name browser feature folders after the browser responsibility. Do not mirror backend ownership with paths such as `state/server` for frontend clients.
- Treat Drizzle as the standard business-layer data API. Query the context directly and compose business specifications from persistence table mappings. Do not add repositories or column-shape abstractions.
- Keep Drizzle table mappings, SQLite connection management, and migrations in the persistence layer. Generate schema migrations with Drizzle Kit instead of writing them by hand.
- Keep functions readable at a glance. When a function mixes orchestration with a distinct validation, state transition, lifecycle step, handler, or database operation, extract that work into a purpose-named function so the caller reads as a sequence of steps. Use judgment instead of a line-count limit, and do not create trivial pass-through helpers.
- Use Effect as the default for server application workflows. Compose Effect-returning operations, typed failures, dependencies, concurrency, and resource lifetimes within Effect. Keep pure calculations and transformations in plain TypeScript.
- Define stable service dependencies with the installed Effect version's Context service APIs and compose live implementations with Layers at application entry points. Own resources and background work through scopes and managed fibers. Do not create a service or Layer for every helper.
- Execute Effects at runtime boundaries. Adapt Promise or callback libraries once at their adapter boundary, including cancellation and cleanup. Avoid nested `runPromise` calls, manual timer and AbortController lifecycles inside Effect services, and parallel Promise APIs without real callers.
- Web server state lives in TanStack Query. Read with `useEnvironmentQuery(route, input)` and write with `useCommand(route)`. Freshness comes from the `EnvironmentChanged` invalidation bridge and query options, never from hand-written caches or controllers. Effect is used in the web only inside the connection layer (`app/environment/connection`, `platform/environment`). Keep rendering, focus and transient interaction state in React.
- A web feature is a folder with hooks and components. Do not add per-feature providers, contexts, controllers, stores, transport clients or error classes; compose the feature where it is rendered.
- Compose complex UI from compound components with explicit children instead of accumulating boolean variants and unrelated props. Separate the state provider from the visual frame so components can share a narrow state/action contract across layouts. Keep ordinary props for simple components; do not create context or compound parts for every element. Preserve accessible behavior and measure render cost on the graph.
- Give every meaningful application action keyboard access from day one. Frequent application actions should have configurable shortcuts; local control behavior should use standard accessible keyboard interaction instead of configurable bindings.
- Implement natural action pairs together when both make sense, including add/remove, open/close, expand/collapse, previous/next, and show/hide.
- Buttons, menus, and shortcuts for the same action must execute the same command or handler. Shortcut labels and accessibility metadata must derive from the configured binding.
- Do not use tooltips anywhere in the application, including native HTML `title` tooltips and tooltip components. Keep accessible names with `aria-label` or visible text; show necessary explanations and action feedback inline.
- Persist shortcut changes in the local client across restarts. Shortcut behavior must work in Electron and browser clients on Linux, macOS, and Windows.
- tests are good, but we don't want to test all the scenarios, especially we don't want to test deleted code. Code is deleted, tests are deleted.
- Do not unit test infrastructure implementation details. Use focused integration tests when an issue requires verification of critical persistence guarantees such as migrations, permissions, database pragmas, or cross-process concurrency.
- generating scripts to solve something without first investigating if it can be done without scripts is not permitted.
- Use Domain driven design, clean architecture, kiss, solid, yagni principles.
- source code will be in root/src, tests will be in root/tests

### Test strategy

- Test behavior at the lowest layer that can prove it. A reviewer can reject an E2E case when a unit, integration, or UI test covers the same risk with less setup.
- Unit tests cover server and domain behavior in isolation. Typed fakes are allowed; infrastructure implementation details do not belong here.
- Integration tests cross one real adapter or resource boundary, such as Git, SQLite, the filesystem, a process, IPC, browser storage, or a network connection.
- UI tests render real UI in a browser with typed fake application clients. They own component states, accessibility, focus, keyboard and pointer interaction, responsive behavior, and error handling.
- E2E tests cover a small set of successful user journeys across real runtime boundaries. Each addition must name the user goal and the boundary chain that a lower layer cannot prove. Do not use E2E for CSS details, isolated widget states, or exhaustive edge cases.
- One E2E journey owns editing a shortcut, restarting the desktop application, and using the saved binding. Unit, integration, and UI tests own detailed shortcut behavior.
- Release smoke tests prove that a produced artifact installs or launches and reports the expected product identity. Keep them separate from feature E2E coverage.
