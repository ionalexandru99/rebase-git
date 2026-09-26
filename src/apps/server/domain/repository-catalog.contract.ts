import type {
  RepositoryCatalogEntry,
  RepositoryPathRejected,
  RepositoryRejected,
} from "@rebase/contracts";
import { Context, type Effect } from "effect";
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
    EnvironmentStorageError | RepositoryRejected
  >;
  readonly remember: (
    path: string,
  ) => Effect.Effect<
    RepositoryCatalogEntry,
    EnvironmentStorageError | RepositoryPathRejected
  >;
  readonly remove: (
    repositoryId: string,
  ) => Effect.Effect<
    { readonly repositoryId: string },
    EnvironmentStorageError | RepositoryRejected
  >;
}

export class RepositoryCatalogAccess extends Context.Service<
  RepositoryCatalogAccess,
  RepositoryCatalog
>()("RepositoryCatalogAccess") {}
