import type {
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

export interface BranchManagement {
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
