import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { RepositoryCatalogClientError } from "#web/features/repository-catalog/repository-catalog-client.contract";
import type { ReadableStore } from "#web/platform/store/store";

export type RepositoryCatalogControllerStatus =
  | "error"
  | "idle"
  | "loading"
  | "ready";

export class RepositoryCatalogUnavailable extends Data.TaggedError(
  "RepositoryCatalogUnavailable",
) {}

export type RepositoryCatalogControllerError =
  | RepositoryCatalogClientError
  | RepositoryCatalogUnavailable;

export interface RepositoryCatalogControllerSnapshot {
  readonly error?: RepositoryCatalogControllerError;
  readonly repositories: readonly RepositoryCatalogEntry[];
  readonly status: RepositoryCatalogControllerStatus;
}

export interface RepositoryCatalogController
  extends ReadableStore<RepositoryCatalogControllerSnapshot> {
  readonly recordOpened: (
    repositoryId: string,
  ) => Promise<RepositoryCatalogEntry>;
  readonly refresh: () => Promise<void>;
  readonly remember: (path: string) => Promise<RepositoryCatalogEntry>;
  readonly remove: (repositoryId: string) => Promise<void>;
}

export interface RepositoryCatalogGateway {
  readonly list: () => Effect.Effect<
    readonly RepositoryCatalogEntry[],
    RepositoryCatalogClientError
  >;
  readonly recordOpened: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryCatalogEntry, RepositoryCatalogClientError>;
  readonly remember: (
    path: string,
  ) => Effect.Effect<RepositoryCatalogEntry, RepositoryCatalogClientError>;
  readonly remove: (
    repositoryId: string,
  ) => Effect.Effect<unknown, RepositoryCatalogClientError>;
}
