import type { CommitInspection } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import type { DesktopUpdates } from "#contracts/desktop-updates/desktop-updates.contract.ts";
import type {
  BlameCommit,
  FileBlame,
} from "#contracts/file-blame/file-blame.contract.ts";
import type { FileHistoryEntry } from "#contracts/file-history/file-history.contract.ts";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type {
  ChangedFile,
  DiscardedChanges,
  RepositoryChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { Comparison } from "#contracts/repository-comparison/compare-revisions.contract.ts";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import type { ConflictDocument } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import type { RepositoryFetchStatus } from "#contracts/repository-pull/repository-pull.contract.ts";
import type { ReflogEntry } from "#contracts/repository-reflog/repository-reflog.contract.ts";
import type {
  BranchUpstream,
  RepositoryRefs,
  RepositoryWorktree,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import type { RepositoryStash } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import type {
  GitHostKind,
  GitHostStatus,
  GitStatus,
  HostRepositories,
} from "#contracts/source-control/source-control.contract.ts";
import type { ThirdPartyLicense } from "#contracts/third-party-licenses/third-party-licenses.contract.ts";
import type {
  WorktreeEntry,
  WorktreeFile,
} from "#contracts/worktree-files/worktree-files.contract.ts";
import type {
  AuthorAvatarStore,
  CachedAvatar,
} from "#web/features/author-avatars/author-avatar-store.ts";
import type { RepositoryScope } from "#web/platform/query/repository-scope.tsx";

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

export function branchScenarioRefs(): RepositoryRefs {
  return repositoryRefs({
    branches: [
      {
        name: "main",
        upstream: upstream("origin/main", { behind: 2 }),
        worktreePath: mainPath,
      },
      { name: "feature" },
      { name: "topic", worktreePath: topicPath },
    ],
    remoteBranches: [
      { name: "feature", remote: "origin" },
      { name: "topic", remote: "origin" },
      { name: "release", remote: "upstream" },
    ],
    tags: [{ name: "v1.0.0" }],
    worktrees: mainAndTopicWorktrees(),
  });
}

export function upstream(
  name: string,
  { ahead = 0, behind = 0, gone = false } = {},
): BranchUpstream {
  return { ahead, behind, gone, name };
}

export function changedFile(
  path: string,
): ChangedFile & { readonly status: "M" };
export function changedFile<Status extends ChangedFile["status"]>(
  path: string,
  status: Status,
  previousPath?: string | null,
  lines?: ChangedFile["lines"],
): ChangedFile & { readonly status: Status };
export function changedFile(
  path: string,
  status: ChangedFile["status"] = "M",
  previousPath: string | null = null,
  lines: ChangedFile["lines"] = null,
): ChangedFile {
  return { path, previousPath, status, lines, lfs: false };
}

export function commitInspection(
  inspection: Partial<CommitInspection> = {},
): CommitInspection {
  const identity = {
    name: "Alex",
    email: "alex@example.test",
    date: "2026-09-15T10:00:00Z",
  };
  return {
    oid: commitId,
    message: "Commit",
    author: identity,
    committer: identity,
    parents: [],
    parentOid: null,
    files: [],
    truncated: false,
    ...inspection,
  };
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

export function conflictDocument(
  path: string,
  content: string,
  revision = path,
): ConflictDocument {
  return {
    file: {
      path,
      revision,
      kind: "both-modified",
      stages: [
        { side: "base", bytes: content.length, binary: false },
        { side: "current", bytes: content.length, binary: false },
        { side: "incoming", bytes: content.length, binary: false },
      ],
      openRegions: content
        .split("\n")
        .filter((line) => line.startsWith(">>>>>>>")).length,
      choices: ["current", "incoming"],
    },
    excerpts: [{ line: 1, text: content }],
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

export function discardedChanges(after = "d"): DiscardedChanges {
  return {
    before: { index: "b".repeat(40), worktree: "c".repeat(40) },
    after: { index: "b".repeat(40), worktree: after.repeat(40) },
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
    steps: null,
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
    color: "blue",
    lastOpenedAt: "2026-09-04T12:00:00.000Z",
    ...entry,
  };
}

export function fetchStatus(
  status: Partial<RepositoryFetchStatus> = {},
): RepositoryFetchStatus {
  return {
    fetching: false,
    defaultIntervalSeconds: 300,
    setting: { _tag: "Inherit" },
    ...status,
  };
}

export function pullRequest(
  number: number,
  pullRequest: Partial<PullRequest> = {},
): PullRequest {
  return {
    kind: "PullRequest",
    number,
    url: `https://github.com/octo/rebase/pull/${number}`,
    title: `Pull request ${number}`,
    state: "Open",
    ...pullRequest,
  };
}

export function sourceControlDiscovery({
  git = { _tag: "Available", version: "git version 2.51.0" },
  lfs = { _tag: "Available", version: "git-lfs/3.8.0" },
  github = {
    _tag: "SignedIn",
    kind: "github",
    enabled: true,
    version: "gh version 2.101.0 (2026-09-15)",
    accounts: [{ host: "github.com", account: "octo" }],
  },
  gitlab = { _tag: "Missing", kind: "gitlab", enabled: true },
  bitbucket = { _tag: "Token", kind: "bitbucket", enabled: true, saved: null },
}: {
  readonly git?: GitStatus;
  readonly lfs?: GitStatus;
  readonly github?: GitHostStatus;
  readonly gitlab?: GitHostStatus;
  readonly bitbucket?: GitHostStatus;
} = {}) {
  return {
    git,
    lfs,
    hosts: [
      github,
      gitlab,
      { _tag: "ComingSoon", kind: "azure-devops" } as const,
      bitbucket,
      { _tag: "ComingSoon", kind: "forgejo" } as const,
    ],
  };
}

export function repositoryScope(
  scope: Partial<RepositoryScope> = {},
): RepositoryScope {
  return {
    repositoryId,
    worktreePath: mainPath,
    logicalRepositoryId: repositoryId,
    connected: true,
    readable: true,
    writable: true,
    switchWorktree: () => undefined,
    ...scope,
  };
}

export function fileHistoryEntry(
  entry: Partial<FileHistoryEntry> = {},
): FileHistoryEntry {
  return {
    oid: commitId,
    parentOid: "b".repeat(40),
    subject: "Change the file",
    author: "Alex",
    authoredAt: 1_790_000_000,
    path: "src/app.ts",
    previousPath: null,
    status: "M",
    lines: { added: 1, removed: 1 },
    ...entry,
  };
}

export function fileBlame(
  blame: Partial<Extract<FileBlame, { _tag: "Blamed" }>> = {},
): FileBlame {
  return {
    _tag: "Blamed",
    text: "one",
    ranges: [{ start: 1, count: 1, oid: commitId, originalLine: 1 }],
    commits: [blameCommit()],
    ...blame,
  };
}

export function blameCommit(commit: Partial<BlameCommit> = {}): BlameCommit {
  return {
    oid: commitId,
    subject: "Change the file",
    author: "Alex",
    email: "alex@example.com",
    authoredAt: 1_790_000_000,
    path: "src/app.ts",
    previous: null,
    ...commit,
  };
}

export function comparison(value: Partial<Comparison> = {}): Comparison {
  return {
    from: "b".repeat(40),
    to: commitId,
    base: "c".repeat(40),
    files: [],
    truncated: false,
    commits: [],
    commitsComplete: true,
    ...value,
  };
}

export function reflogEntry(entry: Partial<ReflogEntry> = {}): ReflogEntry {
  return {
    oid: commitId,
    previousOid: null,
    action: "commit",
    description: "Commit",
    subject: "Commit",
    recordedAt: 1_790_000_000,
    orphaned: false,
    steps: [],
    ...entry,
  };
}

export function repositoryStash(
  stash: Partial<RepositoryStash> = {},
): RepositoryStash {
  return {
    oid: "5".repeat(40),
    name: "Try larger limits",
    named: true,
    auto: false,
    branch: "main",
    staged: false,
    recordedAt: 1_790_000_000,
    ...stash,
  };
}

export function desktopUpdates(
  updates: Partial<DesktopUpdates> = {},
): DesktopUpdates {
  return {
    checkForUpdates: async () => {},
    getSnapshot: async () => ({
      settings: { checkAutomatically: false, releaseChannel: "stable" },
      status: { _tag: "Idle" },
    }),
    installUpdate: async () => {},
    selectReleaseChannel: async () => {},
    setCheckAutomatically: async () => {},
    subscribe: () => () => {},
    ...updates,
  };
}

export function memoryAvatarStore(
  stored: Readonly<Record<string, CachedAvatar>> = {},
): AuthorAvatarStore & { readonly saved: Map<string, CachedAvatar> } {
  const saved = new Map<string, CachedAvatar>();
  return {
    saved,
    load: async () => new Map(Object.entries(stored)),
    save: (_provider, email, avatar) => saved.set(email, avatar),
  };
}

export function hostRepositories({
  kind = "github",
  host = "github.com",
  account = "alex",
  repositories,
}: {
  readonly kind?: GitHostKind;
  readonly host?: string;
  readonly account?: string;
  readonly repositories: readonly {
    readonly name: string;
    readonly private?: boolean;
  }[];
}): HostRepositories {
  return {
    kind,
    host,
    account,
    repositories: repositories.map(({ name, private: hidden = false }) => ({
      name,
      url: `git@${host}:${name}.git`,
      private: hidden,
    })),
  };
}

export function worktreeEntry(
  name: string,
  kind: WorktreeEntry["kind"] = "file",
  ignored = false,
): WorktreeEntry {
  return { name, kind, ignored };
}

export function worktreeText(contents: string): WorktreeFile {
  return {
    _tag: "Text",
    contents,
    bytes: contents.length,
    truncated: false,
  };
}

export function thirdPartyLicense(
  license: Partial<ThirdPartyLicense> = {},
): ThirdPartyLicense {
  return {
    name: "react",
    version: "19.3.0",
    license: "MIT",
    sourceUrl: "https://github.com/facebook/react",
    notice: "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.",
    ...license,
  };
}
