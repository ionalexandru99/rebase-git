import { Schema } from "effect";
import { Rpc, type RpcClient, type RpcClientError, RpcGroup } from "effect/rpc";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
import { CommandProgressRpc } from "#contracts/command-progress/command-progress.contract.ts";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { EnvironmentAuthorizationApi } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import { EnvironmentFilesystemApi } from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import { FileHistoryApi } from "#contracts/file-history/file-history.contract.ts";
import { GitIdentityApi } from "#contracts/git-identity/git-identity.contract.ts";
import { HistorySearchApi } from "#contracts/history-search/history-search.contract.ts";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { CompareApi } from "#contracts/repository-comparison/compare-revisions.contract.ts";
import { RepositoryConflictsApi } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { RepositoryHistoryRpc } from "#contracts/repository-history/repository-history.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryReflogApi } from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { RepositoryBranchesApi } from "#contracts/repository-refs/repository-branches.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import { RepositoryStashesApi } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import { RepositoryWorktreesApi } from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { TerminalsApi } from "#contracts/terminal/terminal.contract.ts";
import { WorktreeFilesApi } from "#contracts/worktree-files/worktree-files.contract.ts";

export const environmentProtocol = 5;
export const environmentMaxMessageBytes = 64 * 1_048_576;
export const environmentLivePath = "/api/environment/live";
export const environmentSubprotocol = "rebase";
export const unauthorizedCloseCode = 4401;

const EnvironmentId = Schema.String.check(Schema.isUUID(4));

export const EnvironmentHello = Schema.Struct({
  protocol: Schema.Natural,
});

export const EnvironmentGreeting = Schema.Struct({
  environmentId: EnvironmentId,
  sequence: Schema.Natural,
});
export type EnvironmentGreeting = typeof EnvironmentGreeting.Type;

export const ProtocolMismatch = Schema.TaggedStruct("ProtocolMismatch", {
  serverProtocol: Schema.Natural,
});
export type ProtocolMismatch = typeof ProtocolMismatch.Type;

export const RepositoryChangeKind = Schema.Literals([
  "Refs",
  "Index",
  "Fetch",
  "Terminals",
]);
export type RepositoryChangeKind = typeof RepositoryChangeKind.Type;

export const EnvironmentChanged = Schema.TaggedStruct("EnvironmentChanged", {
  sequence: Schema.Natural,
  repositoryIds: Schema.optionalKey(Schema.Array(EnvironmentId)),
  kind: Schema.optionalKey(RepositoryChangeKind),
});
export type EnvironmentChanged = typeof EnvironmentChanged.Type;

export const EnvironmentRpc = RpcGroup.make(
  Rpc.make("Hello", {
    payload: EnvironmentHello,
    success: EnvironmentGreeting,
    error: ProtocolMismatch,
  }),
  Rpc.make("WatchEnvironment", {
    success: EnvironmentChanged,
    stream: true,
  }),
  ...Object.values(EnvironmentAuthorizationApi),
  ...Object.values(EnvironmentFilesystemApi),
  ...Object.values(RepositoryCatalogApi),
  ...Object.values(CommitInspectionApi),
  ...Object.values(FileHistoryApi),
  ...Object.values(HistorySearchApi),
  ...Object.values(WorktreeFilesApi),
  ...Object.values(CompareApi),
  ...Object.values(RepositoryChangesApi),
  ...Object.values(RepositoryConflictsApi),
  ...Object.values(RepositoryOperationsApi),
  ...Object.values(RepositoryPullApi),
  ...Object.values(PullRequestsApi),
  ...Object.values(RepositoryPushApi),
  ...Object.values(RepositoryReflogApi),
  ...Object.values(RepositoryRefsApi),
  ...Object.values(RepositoryBranchesApi),
  ...Object.values(BranchSettlingApi),
  ...Object.values(RepositoryTagsApi),
  ...Object.values(RepositoryStashesApi),
  ...Object.values(RepositoryWorktreesApi),
  ...Object.values(SourceControlApi),
  ...Object.values(GitIdentityApi),
  ...Object.values(TerminalsApi),
).merge(RepositoryHistoryRpc, CommandProgressRpc);

export type EnvironmentRpcs = RpcGroup.Rpcs<typeof EnvironmentRpc>;

export type EnvironmentRpcClient = RpcClient.RpcClient<
  EnvironmentRpcs,
  RpcClientError.RpcClientError
>;
