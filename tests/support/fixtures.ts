import type {
  BranchUpstream,
  ChangeDiff,
  ChangedFile,
  RepositoryCatalogEntry,
  RepositoryChanges,
  RepositoryFreshness,
  RepositoryOperation,
  RepositoryRefs,
  RepositoryWorktree,
} from "@rebase/contracts";

export const repositoryId = "00000000-0000-4000-8000-000000000001";
export const commitId = "a".repeat(40);
export const mainPath = "/repo";
export const topicPath = "/repo/.worktrees/topic";

export function repositoryRefs(
  refs: Partial<RepositoryRefs> = {},
): RepositoryRefs {
  return {
    repositoryId,
    branches: [],
    remoteBranches: [],
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [],
    ...refs,
  };
}

export function worktree(path: string, branch: string): RepositoryWorktree {
  return { head: { branch, commit: commitId }, main: path === mainPath, path };
}

export function mainAndTopicWorktrees(): RepositoryWorktree[] {
  return [worktree(mainPath, "main"), worktree(topicPath, "topic")];
}

export function upstream(
  name: string,
  { ahead = 0, behind = 0, gone = false } = {},
): BranchUpstream {
  return { ahead, behind, gone, name };
}

export function changedFile<Status extends ChangedFile["status"] = "M">(
  path: string,
  status = "M" as Status,
  previousPath: string | null = null,
) {
  return { path, previousPath, status };
}

export function changeDiff(
  path: string,
  diff: Partial<ChangeDiff> = {},
): ChangeDiff {
  return {
    path,
    revision: path,
    kind: "binary",
    before: null,
    after: null,
    beforeBytes: 10,
    afterBytes: 100,
    mime: null,
    patch: "",
    ...diff,
  };
}

export function repositoryChanges(
  changes: Partial<RepositoryChanges> = {},
): RepositoryChanges {
  return {
    revision: "one",
    head: commitId,
    message: "",
    unstaged: [],
    staged: [],
    renamesLimited: false,
    ...changes,
  };
}

export function repositoryOperation(
  operation: Partial<RepositoryOperation> = {},
): RepositoryOperation {
  return {
    kind: "idle",
    phase: "idle",
    revision: "idle",
    branch: null,
    commit: null,
    mergedBranch: null,
    progress: null,
    unresolvedPaths: [],
    actions: [],
    lock: null,
    ...operation,
  };
}

export function conflictedRebase(
  operation: Partial<RepositoryOperation> = {},
): RepositoryOperation {
  return repositoryOperation({
    kind: "rebase",
    phase: "conflicts",
    revision: "one",
    branch: "topic",
    commit: commitId,
    progress: { current: 3, total: 8 },
    unresolvedPaths: ["file.txt"],
    actions: [
      { action: "continue", enabled: false, reason: "Resolve conflicts." },
      { action: "skip", enabled: true, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
    ...operation,
  });
}

export function catalogEntry(
  entry: Partial<RepositoryCatalogEntry> = {},
): RepositoryCatalogEntry {
  return {
    id: repositoryId,
    name: "repository",
    path: mainPath,
    addedAt: "2026-09-04T12:00:00.000Z",
    lastOpenedAt: "2026-09-04T12:00:00.000Z",
    ...entry,
  };
}

export function repositoryFreshness(
  freshness: Partial<RepositoryFreshness> = {},
): RepositoryFreshness {
  return {
    revision: 0,
    fetching: false,
    stale: false,
    defaultIntervalSeconds: 300,
    setting: { _tag: "Inherit" },
    ...freshness,
  };
}
