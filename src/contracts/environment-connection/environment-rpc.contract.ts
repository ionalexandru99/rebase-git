import { CommitInspectionApi } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { EnvironmentAuthorizationApi } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { EnvironmentFilesystemApi } from "@rebase/contracts/environment-filesystem/environment-filesystem.contract";
import { RepositoryCatalogApi } from "@rebase/contracts/repository-catalog/repository-catalog.contract";
import { RepositoryChangesApi } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { RepositoryConflictsApi } from "@rebase/contracts/repository-conflicts/repository-conflicts.contract";
import { RepositoryHistoryRpc } from "@rebase/contracts/repository-history/repository-history.contract";
import { RepositoryOperationsApi } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { RepositoryPullApi } from "@rebase/contracts/repository-pull/repository-pull.contract";
import { RepositoryPushApi } from "@rebase/contracts/repository-push/repository-push.contract";
import { RepositoryBranchesApi } from "@rebase/contracts/repository-refs/repository-branches.contract";
import { RepositoryRefsApi } from "@rebase/contracts/repository-refs/repository-refs.contract";
import { RepositoryTagsApi } from "@rebase/contracts/repository-refs/repository-tags.contract";
import { Schema } from "effect";
import {
  Rpc,
  type RpcClient,
  type RpcClientError,
  RpcGroup,
} from "effect/unstable/rpc";

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

export const RepositoryChangeKind = Schema.Literals(["Refs", "Index", "Fetch"]);
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
  ...Object.values(RepositoryChangesApi),
  ...Object.values(RepositoryConflictsApi),
  ...Object.values(RepositoryOperationsApi),
  ...Object.values(RepositoryPullApi),
  ...Object.values(RepositoryPushApi),
  ...Object.values(RepositoryRefsApi),
  ...Object.values(RepositoryBranchesApi),
  ...Object.values(RepositoryTagsApi),
).merge(RepositoryHistoryRpc);

export type EnvironmentRpcs = RpcGroup.Rpcs<typeof EnvironmentRpc>;

export type EnvironmentRpcClient = RpcClient.RpcClient<
  EnvironmentRpcs,
  RpcClientError.RpcClientError
>;
