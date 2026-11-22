import { z } from "zod";
import { AuthorAvatarsApi } from "#contracts/author-avatars/author-avatars.contract.ts";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
import { CommandProgressApi } from "#contracts/command-progress/command-progress.contract.ts";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { DiagnosticsApi } from "#contracts/diagnostics/diagnostics.contract.ts";
import { EnvironmentAuthorizationApi } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import {
  type AnyEnvironmentRoute,
  route,
  streamRoute,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { EnvironmentFilesystemApi } from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import { FileBlameApi } from "#contracts/file-blame/file-blame.contract.ts";
import { FileHistoryApi } from "#contracts/file-history/file-history.contract.ts";
import { GitIdentityApi } from "#contracts/git-identity/git-identity.contract.ts";
import { GitSigningApi } from "#contracts/git-signing/git-signing.contract.ts";
import { HistorySearchApi } from "#contracts/history-search/history-search.contract.ts";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { CompareApi } from "#contracts/repository-comparison/compare-revisions.contract.ts";
import { RepositoryConflictsApi } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { RepositoryHistoryApi } from "#contracts/repository-history/repository-history.contract.ts";
import { RepositoryLfsApi } from "#contracts/repository-lfs/repository-lfs.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  FetchPruneApi,
  PullStrategyApi,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryReflogApi } from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { RepositoryBranchesApi } from "#contracts/repository-refs/repository-branches.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import { RepositoryStashesApi } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import { RepositoryWorktreesApi } from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import { SignatureVerificationApi } from "#contracts/signature-verification/signature-verification.contract.ts";
import { SourceControlApi } from "#contracts/source-control/source-control.contract.ts";
import { TerminalsApi } from "#contracts/terminal/terminal.contract.ts";
import { WorktreeFilesApi } from "#contracts/worktree-files/worktree-files.contract.ts";

export const environmentProtocol = 7;
export const environmentMaxMessageBytes = 64 * 1_048_576;
export const environmentLivePath = "/api/environment/live";
export const environmentSubprotocol = "rebase";
export const unauthorizedCloseCode = 4401;

const EnvironmentId = z.uuidv4();

export const EnvironmentHello = z.object({
  protocol: z.int().nonnegative(),
});

export const EnvironmentGreeting = z.object({
  environmentId: EnvironmentId,
});
export type EnvironmentGreeting = z.infer<typeof EnvironmentGreeting>;

export const ProtocolMismatch = z.object({
  _tag: z.literal("ProtocolMismatch"),
  serverProtocol: z.int().nonnegative(),
});
export type ProtocolMismatch = z.infer<typeof ProtocolMismatch>;

export const RepositoryChangeKind = z.enum([
  "Refs",
  "Index",
  "Fetch",
  "Terminals",
]);
export type RepositoryChangeKind = z.infer<typeof RepositoryChangeKind>;

export const EnvironmentChanged = z.object({
  _tag: z.literal("EnvironmentChanged"),
  sequence: z.int().nonnegative(),
  repositoryIds: z.array(EnvironmentId).readonly().exactOptional(),
  kind: RepositoryChangeKind.exactOptional(),
});
export type EnvironmentChanged = z.infer<typeof EnvironmentChanged>;

export const EnvironmentSessionApi = {
  hello: route("Hello", {
    request: EnvironmentHello,
    success: EnvironmentGreeting,
    failure: ProtocolMismatch,
  }),
  watch: streamRoute("WatchEnvironment", { success: EnvironmentChanged }),
};

export const environmentRoutes: readonly AnyEnvironmentRoute[] = [
  EnvironmentSessionApi,
  EnvironmentAuthorizationApi,
  EnvironmentFilesystemApi,
  RepositoryCatalogApi,
  CommitInspectionApi,
  FileHistoryApi,
  HistorySearchApi,
  WorktreeFilesApi,
  FileBlameApi,
  CompareApi,
  RepositoryChangesApi,
  RepositoryConflictsApi,
  RepositoryLfsApi,
  RepositoryOperationsApi,
  RepositoryPullApi,
  FetchPruneApi,
  PullStrategyApi,
  PullRequestsApi,
  AuthorAvatarsApi,
  RepositoryPushApi,
  RepositoryReflogApi,
  RepositoryRefsApi,
  RepositoryBranchesApi,
  BranchSettlingApi,
  RepositoryTagsApi,
  RepositoryStashesApi,
  RepositoryWorktreesApi,
  SourceControlApi,
  GitIdentityApi,
  SignatureVerificationApi,
  GitSigningApi,
  TerminalsApi,
  DiagnosticsApi,
  RepositoryHistoryApi,
  CommandProgressApi,
].flatMap((api): AnyEnvironmentRoute[] => Object.values(api));
