import type {
  CheckoutRepositoryRef,
  RepositoryCatalogEntry,
  RepositoryCheckedOut,
  RepositoryRefs,
  RepositoryRefsOperationFailure,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";

export interface RepositoryRefsService {
  readonly checkout: (
    command: CheckoutRepositoryRef,
  ) => Effect.Effect<
    RepositoryCheckedOut,
    EnvironmentStorageError | RepositoryRefsError
  >;
  readonly read: (
    repositoryId: string,
  ) => Effect.Effect<
    RepositoryRefs,
    EnvironmentStorageError | RepositoryRefsError
  >;
}

export interface RepositoryChangePublisher {
  readonly watch: (repository: RepositoryCatalogEntry) => Effect.Effect<void>;
}

export class RepositoryRefsError extends Data.TaggedError(
  "RepositoryRefsError",
)<{
  readonly cause?: unknown;
  readonly failure: RepositoryRefsOperationFailure;
}> {}
