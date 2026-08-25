import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { RepositoryCatalogClientError } from "#web/features/repository-catalog/repository-catalog-client.contract";

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

export interface RepositoryCatalogController {
  readonly getSnapshot: () => RepositoryCatalogControllerSnapshot;
  readonly recordOpened: (
    repositoryId: string,
  ) => Promise<RepositoryCatalogEntry>;
  readonly refresh: () => Promise<void>;
  readonly remember: (path: string) => Promise<RepositoryCatalogEntry>;
  readonly remove: (repositoryId: string) => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface RepositoryCatalogGateway {
  readonly list: (
    credential: string,
  ) => Effect.Effect<
    readonly RepositoryCatalogEntry[],
    RepositoryCatalogClientError
  >;
  readonly recordOpened: (
    credential: string,
    repositoryId: string,
  ) => Effect.Effect<RepositoryCatalogEntry, RepositoryCatalogClientError>;
  readonly remember: (
    credential: string,
    path: string,
  ) => Effect.Effect<RepositoryCatalogEntry, RepositoryCatalogClientError>;
  readonly remove: (
    credential: string,
    repositoryId: string,
  ) => Effect.Effect<unknown, RepositoryCatalogClientError>;
}
