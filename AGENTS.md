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

## Performance

Performance is one of the corner stones of the application. Speed is the non negotiable aspect of the app. If it is not fast it is bad.
Everything should feel smooth, with as little lag as possible, regardless of the means of interacting with the repository, it being direct in the file system, or via SSH.
Commits should load on the computer without input lag and the app should react fast.
Pressing on a button should show something happening as fast as possible, not wait.

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

- We want the code to be as simple as possible, easy to extend
- Use workspace package names for cross-package imports. Within a package, use its configured private aliases such as `#server/*`, `#web/*`, `#web-ui/*`, and `#desktop/*` for implementation imports. Do not use relative imports in source or tests, and do not expose implementation wildcards through package `exports` solely to resolve internal modules.
- Keep cross-module contracts in domain-specific `*.contract.ts` files, separate from their implementations.
- Keep business modules under `features/<feature-name>`. Keep `domain` and `persistence` as sibling top-level layers outside `features`.
- Name browser feature folders after the browser responsibility. Do not mirror backend ownership with paths such as `state/server` for frontend clients.
- Treat Drizzle as the standard business-layer data API. Query the context directly and compose business specifications from persistence table mappings. Do not add repositories or column-shape abstractions.
- Keep Drizzle table mappings, SQLite connection management, and migrations in the persistence layer. Generate schema migrations with Drizzle Kit instead of writing them by hand.
- Keep functions readable at a glance. When a function mixes orchestration with a distinct validation, state transition, lifecycle step, handler, or database operation, extract that work into a purpose-named function so the caller reads as a sequence of steps. Use judgment instead of a line-count limit, and do not create trivial pass-through helpers.
- Use Effect to keep asynchronous workflows with resources, concurrency, cancellation, or typed failures consistent. Prefer plain TypeScript when it is simpler. Do not complicate a workflow or add library abstractions only to use Effect.
- keyboard shourcuts should be implemented from day 1
- tests are good, but we don't want to test all the scenarios, especially we don't want to test deleted code. Code is deleted, tests are deleted.
- Do not unit test infrastructure implementation details. Use focused integration tests when an issue requires verification of critical persistence guarantees such as migrations, permissions, database pragmas, or cross-process concurrency.
- generating scripts to solve something without first investigating if it can be done without scripts is not permitted.
- Use Domain driven design, clean architecture, kiss, solid, yagni principles.
- source code will be in root/src, tests will be in root/tests
