# Rebase

A desktop Git GUI (Electron + React 19). The renderer talks to a forked Git **sidecar** over IPC; the sidecar owns all `simple-git` work. This glossary names the domain concepts shared across those processes.

## Language

**Repo Session**:
The live state of one open repository inside the sidecar — its `simple-git` instance, any in-flight child processes (fetch, commit-graph write), and its locks. Created when a repo is opened, torn down as a unit when it is closed.
_Avoid_: repo handle, git context, connection

**Timeline**:
The commit-graph history view and the set of refs currently shown on it. Distinct from the raw commit **log** (the underlying data) — the Timeline is the log filtered to the visible refs and the commits reachable from them.
_Avoid_: graph (the rendering), history (the panel)
