import type {
  RepositoryCatalogEntry,
  RepositoryCatalogOperationFailure,
} from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";

export interface RepositoryCatalog {
  readonly find: (
    repositoryId: string,
  ) => Effect.Effect<
    RepositoryCatalogEntry | undefined,
    EnvironmentStorageError
  >;
  readonly list: () => Effect.Effect<
    readonly RepositoryCatalogEntry[],
    EnvironmentStorageError
  >;
  readonly recordOpened: (
    repositoryId: string,
  ) => Effect.Effect<
    RepositoryCatalogEntry,
    EnvironmentStorageError | RepositoryCatalogError
  >;
  readonly remember: (
    path: string,
  ) => Effect.Effect<
    RepositoryCatalogEntry,
    EnvironmentStorageError | RepositoryCatalogError
  >;
  readonly remove: (
    repositoryId: string,
  ) => Effect.Effect<
    { readonly repositoryId: string },
    EnvironmentStorageError | RepositoryCatalogError
  >;
}

export class RepositoryCatalogError extends Data.TaggedError(
  "RepositoryCatalogError",
)<{
  readonly cause?: unknown;
  readonly failure: RepositoryCatalogOperationFailure;
}> {}

export class RepositoryCatalogAccess extends Context.Service<
  RepositoryCatalogAccess,
  Pick<RepositoryCatalog, "find">
>()("RepositoryCatalogAccess") {}
