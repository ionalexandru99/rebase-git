# Missing Features Analysis — Rebase Git GUI

## Current Problem Statement

The codebase is a functional Electron + React Git GUI with a sidecar HTTP architecture. It already supports core local-Git workflows (status, staging, commits, diffs, history, branch checkout, fetch/push/pull). The goal of this analysis is to identify which features are **missing** relative to a competitive desktop Git client.

## Methodology

1. Read project metadata (`package.json`, `README.md`, `AGENTS.md`).
2. Enumerate all source files under `src/`.
3. Read the sidecar operation surface (`src/shared/sidecar-ops.ts`, `src/sidecar/operations.ts`, `src/sidecar/server.ts`, `src/shared/schemas/ipc.ts`, `src/shared/schemas/git.ts`).
4. Read the renderer store and primary view components (`src/renderer/stores/git.tsx`, `src/renderer/Workspace.tsx`, `src/renderer/WorkspaceViews.tsx`, `src/renderer/components/*`).
5. Read main-process IPC, settings, and menu code (`src/main/ipc/*`, `src/main/store.ts`, `src/main/menu.ts`, `src/main/updater.ts`).
6. Run the renderer and main unit test suites to confirm baseline health.

## Confirmed Implemented Features

| Area | Feature | Evidence |
|------|---------|----------|
| Repo lifecycle | Open / close repos, one-tab-per-repo enforcement | `RepoTab.tsx`, `useTabs.ts`, `repoIpc.ts` |
| Onboarding | Workspace picker, folder scan for repos | `OnboardingScreen/`, `workspaceIpc.ts` |
| Tabs | New tab, close tab, switch tab, persist/restore tabs | `useTabs.ts`, `App.tsx`, `RepoRail.tsx` |
| Status | Modified, staged, untracked, conflicted, deleted, created, renamed | `StatusPanel/`, `GitStatusSchema` |
| Staging | Stage/unstage files, stage/unstage all, stage/unstage hunks | `operations.ts`, `DiffPanel/index.tsx` |
| Diffs | Unified diff view, syntax highlighting (Shiki), binary detection, untracked diffs | `DiffPanel/index.tsx`, `diff-highlight.ts` |
| Commits | Commit with message subject-length hint | `CommitPanel.tsx` |
| History | Virtualized commit graph, branch filtering, text filter, load-more | `HistoryPanel/`, `log-stream.ts` |
| Branches | Local/remote/tag ref tree, checkout local/remote/tag, timeline visibility toggles | `RefTreePanel.tsx`, `RefTreeRow/`, `checkout.ts` |
| Remotes | Fetch, push (with `--set-upstream` fallback), pull `--ff-only` | `operations.ts`, `push-operations.integration.test.ts` |
| Auto-refresh | Background fetch every 5 min, file-system watcher for working-tree/ref changes | `git.tsx`, `repoWatcher.ts` |
| Settings | Theme (dark/light), recent repos, workspaces, sidebar width, ref-tree toggles, persisted tabs | `store.ts` |
| Updater | Auto-updater wired to `electron-updater` | `updater.ts` |
| Context menu | Electron context menu (inspect in dev) | `menu.ts` |
| Tests | Renderer unit, main unit, integration, E2E, smoke | `package.json` scripts |

## Notable Architectural Observations

- The renderer is **React 19**, not SolidJS. `AGENTS.md` says SolidJS, but `package.json` and the code confirm React. There is a set of SolidJS-API compatibility wrappers (`src/renderer/lib/react-compat.tsx`, `react-query-compat.ts`, `react-store-compat.ts`, `react-dom-compat.tsx`, `react-virtual-compat.ts`) that expose Solid-like primitives on top of React.
- Git work is isolated in a forked `utilityProcess` HTTP sidecar on loopback with bearer-token auth, as documented.
- There are no `TODO`/`FIXME`/`XXX` comments in `src/`.
- All unit tests pass (240 renderer tests, 119 main tests).

## Missing Features (Categorized)

### 1. Repository Creation & Cloning

- **Clone remote repository** — no `git clone` operation or UI.
- **Initialize new repository** — no `git init` operation or UI.
- **Open recent repo from a deep link / URL handler** — no `app.setAsDefaultProtocolClient` or `open-url` handling.

### 2. Advanced Local Git Operations

- **Stash management** — no `git stash list/show/apply/pop/drop/create`.
- **Tag management** — tags are displayed but cannot be created, annotated, deleted, or pushed.
- **Branch management beyond checkout** — no create branch, rename branch, delete branch, merge branch.
- **Reset operations** — no soft/mixed/hard reset to a commit or HEAD.
- **Revert / cherry-pick** — no commit reverting or cherry-picking.
- **Rebase / interactive rebase** — not implemented.
- **Merge conflict resolution UI** — conflicted files are listed (`conflicted` array) but there is no merge-tool integration or conflict marker view.
- **Amend last commit** — no commit amend.
- **Discard changes / discard hunk** — no `git checkout -- <file>` or `git restore` equivalent.

### 3. Remote & Collaboration

- **Add / edit / remove remotes** — remotes are read-only after `openRepo`.
- **Fetch from a specific remote** — `fetchRepo` always runs `git fetch --prune` with no remote selector.
- **Pull with options** — only `--ff-only`; no rebase pull or custom strategy.
- **Push to specific remote/branch** — only `git push` / `--set-upstream origin HEAD`.
- **Force push / push with lease** — not available.
- **Authentication UI** — relies on `GIT_TERMINAL_PROMPT=0`; no credential helper UI for HTTPS/SSH.

### 4. Commit History Deep Dive

- **View commit details / file list for a selected commit** — clicking a commit in history does nothing.
- **Diff between arbitrary commits / branches** — only working-tree diffs exist.
- **Copy SHA / checkout commit / create branch from commit** — not implemented.
- **Search history by author, date range, path** — only text filter on subject.
- **Show commit signatures / GPG verification** — not supported.

### 5. File Tree & Working Tree

- **Full file tree browser** — only changed files are shown; no repo file explorer.
- **Open file / reveal in finder** — no "Open in Editor" or "Reveal in Finder" actions.
- **Ignore / untrack files** — no `.gitignore` editing or `git rm --cached`.
- **Rename detection in UI** — `renamed` files are in schema but UI handling is minimal.

### 6. Settings & Customization

- **Settings panel** — only onboarding/workspace settings exist; no general preferences UI.
- **Configurable keyboard shortcuts** — only tab shortcuts (`Ctrl/Cmd+T`, `Ctrl/Cmd+W`, `Ctrl/Cmd+Shift+[]`) exist.
- **Custom themes / accent color** — theme is dark/light only, no picker.
- **Git config editor** — no user name/email or other git-config UI.
- **External editor integration** — none.
- **Diff font / line-wrap / tab-size preferences** — none.

### 7. Application Shell & UX

- **Native application menu** — only a context menu is set up; no top-level menu bar with Git actions.
- **Status bar / comprehensive ahead/behind display** — ahead/behind is computed for branches but not prominently shown for the current branch.
- **Toolbar buttons for stage all / unstage all in the topbar** — stage-all exists inside `StatusPanel`, not a global toolbar.
- **Multi-select files** — only single-file selection in diff panel.
- **Drag-and-drop files to stage** — not implemented.

### 8. Submodules & Large Repos

- **Submodule support** — no `git submodule` operations.
- **Worktrees** — no `git worktree` support.
- **Partial clone / sparse checkout** — not implemented.
- **LFS** — no Git LFS awareness.

### 9. Search & Navigation

- **Global search / grep across commits** — not implemented.
- **Blame / annotate file** — not implemented.
- **Jump to branch / tag with quick open** — `RepoPicker` only lists repos, not refs.

### 10. Safety & Audit

- **Confirmation dialogs for destructive ops** — no modal confirmations before checkout/reset/discard.
- **Operation progress UI** — only spinners for push/pull; no progress bars for long operations.
- **Undo / redo stack** — not implemented.

## Prioritization Suggestions

Based on the README "Next Steps / Ideas" and common Git GUI expectations, the highest-value next features are:

1. **Show diffs for a selected commit in history** (history is read-only today).
2. **Create / delete / rename branches** (branch management).
3. **Stash management** (frequently used daily workflow).
4. **Clone / init repository** (onboarding completeness).
5. **Settings panel** (theme, git config, external editor).
6. **Discard changes / restore file** (safety-critical local workflow).
7. **Tag management** (create, push, delete tags).
8. **Merge / rebase support** with conflict resolution UI.

## Verification Commands Run

```bash
pnpm test:renderer --reporter=dot
pnpm test:main --reporter=dot
```

Results: 240 renderer tests passed, 119 main tests passed.

## Open Questions

- Should the renderer stay on React 19, or is there an active plan to migrate to SolidJS as stated in `AGENTS.md`?
- Is the immediate priority feature work on history-commit inspection, or branch/stash management?
- Should destructive operations (discard, reset, branch delete) block on native confirmation dialogs?

## Recommended Next Action

Pick one high-value missing feature (e.g., **inspect a commit in history**) and implement it end-to-end with sidecar operation, renderer UI, and tests, following the existing sidecar-first architecture.
