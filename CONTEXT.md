# Rebase

A desktop Git GUI (Electron + React 19). The renderer talks to a forked Git **sidecar** over IPC; the sidecar owns all `simple-git` work. This glossary names the domain concepts shared across those processes.

## Language

**Repo Session**:
The live state of one open repository inside the sidecar — its `simple-git` instance, any in-flight child processes (fetch, commit-graph write), and its locks. Created when a repo is opened, torn down as a unit when it is closed.
_Avoid_: repo handle, git context, connection

**Timeline**:
The commit-graph history view and the set of refs currently shown on it. Distinct from the raw commit **log** (the underlying data) — the Timeline is the log filtered to the visible refs and the commits reachable from them.
_Avoid_: graph (the rendering), history (the panel)

**Mainline**:
The first-parent-only ancestor chain of a ref tip — the near-linear "trunk" you get by following each commit's first parent and ignoring merged-in branches. The default Timeline shows the union of the Mainlines of the visible tips; this is what makes a merge-heavy history read as roughly linear.
_Avoid_: trunk, main branch (a Mainline is per-tip, not the `main` ref)

**Side branch**:
The commits a merge brought in through its non-first-parent edges — they exist in the log but sit off the Mainline and are hidden by default. A Side branch is defined relative to a particular merge, not to any ref.
_Avoid_: feature branch, topic branch (those name refs; a Side branch is a merge-relative set of commits)

**Collapsed / Expanded merge**:
A merge is **collapsed** when its Side branch commits are hidden (the default) and **expanded** when they are shown. Collapse/expand is a property of the view, not of the repository — it changes what the Timeline renders, never the underlying history.
_Avoid_: folded/unfolded

**Diverged**:
A branch and its upstream have each gained commits the other lacks — both tips sit ahead of their common ancestor. A Diverged branch cannot be published by a normal (fast-forward) push; republishing it means rewriting the remote tip. This is the state an amend or rebase produces.
_Avoid_: behind, out-of-date (those name the one-sided case where only the remote moved)
