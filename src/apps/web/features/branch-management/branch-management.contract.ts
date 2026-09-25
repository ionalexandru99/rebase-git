import type {
  BranchUpstreamTarget,
  CreateRepositoryBranch,
  DeleteRepositoryBranch,
  LocalBranch,
  RenameRepositoryBranch,
  RepositoryBranchDeleted,
  RepositoryBranchesHttpApi,
  RepositoryBranchesHttpFailure,
  RepositoryBranchRenamed,
  SetRepositoryBranchUpstream,
} from "@rebase/contracts";
import type { EnvironmentHttpRoutesClient } from "@rebase/environment-client";
import { Data } from "effect";

export class RepositoryBranchesResponseError extends Data.TaggedError(
  "RepositoryBranchesResponseError",
) {}

export class RepositoryBranchesRejected extends Data.TaggedError(
  "RepositoryBranchesRejected",
)<{
  readonly failure: RepositoryBranchesHttpFailure;
  readonly status: number;
}> {}

export type BranchManagementError =
  | RepositoryBranchesRejected
  | RepositoryBranchesResponseError;

export type RepositoryBranchesClient = EnvironmentHttpRoutesClient<
  typeof RepositoryBranchesHttpApi,
  BranchManagementError
>;

export interface BranchWrites {
  readonly create: (command: CreateRepositoryBranch) => Promise<LocalBranch>;
  readonly delete: (
    command: DeleteRepositoryBranch,
  ) => Promise<RepositoryBranchDeleted>;
  readonly rename: (
    command: RenameRepositoryBranch,
  ) => Promise<RepositoryBranchRenamed>;
  readonly setUpstream: (
    command: SetRepositoryBranchUpstream,
  ) => Promise<LocalBranch>;
}

export interface BranchActions {
  readonly create: (branch: {
    readonly checkout: boolean;
    readonly name: string;
    readonly startPoint: string;
    readonly track?: BranchUpstreamTarget;
  }) => Promise<void>;
  readonly delete: (
    deletion: Omit<DeleteRepositoryBranch, "repositoryId" | "worktreePath">,
  ) => Promise<RepositoryBranchDeleted>;
  readonly rename: (branch: BranchRename) => Promise<void>;
  readonly setUpstream: (branch: {
    readonly name: string;
    readonly upstream: BranchUpstreamTarget | null;
  }) => Promise<void>;
}

export interface BranchRename {
  readonly expectedTarget?: string;
  readonly name: string;
  readonly newName: string;
}

export interface BranchCreateRequest {
  readonly oid: string;
  readonly sequence: number;
}
