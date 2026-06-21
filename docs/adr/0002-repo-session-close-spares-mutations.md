# Closing a Repo Session spares in-flight mutations

**Status:** accepted

When a Repo Session closes (tab closed, repo switched), it force-kills only cancel-safe background work — the `git fetch` and the commit-graph write, both idempotent and regenerable. It does **not** force-kill an in-flight mutation (`commit`, `merge`, `reset`, `cherry-pick`, `revert`, stash apply/pop): the session is marked closed so new `requireGit` calls fail `RepoNotOpen`, but the running mutation is allowed to complete and release its lock through its own finalizer, and the session's last resources are reclaimed only when it settles.

## Why

Interrupting a `git commit`/`merge`/`reset` mid-write can land a partial index or ref update — a corruption that is invisible until the user looks. Background fetch / commit-graph writes have no such hazard. So `close` is not uniformly "cancel everything": the kill-on-interrupt finalizer is attached to background processes, while the lock gets a release-on-completion finalizer.

## Consequences

The instinct to "make `close` consistent" by closing the scope and interrupting every fiber must be resisted — it would reintroduce the corruption risk this decision exists to prevent. Tests assert that a mutation in flight at `close` time runs to completion.
