import type {
  EnvironmentAccessFailure,
  RepositoryCatalogHttpApi,
  RepositoryPathRejected,
  RepositoryRejected,
} from "@rebase/contracts";
import { Data } from "effect";
import type { EffectRoutesClient } from "#web/platform/environment/effect-routes-client";

export class RepositoryCatalogResponseError extends Data.TaggedError(
  "RepositoryCatalogResponseError",
) {}

export class RepositoryCatalogRejected extends Data.TaggedError(
  "RepositoryCatalogRejected",
)<{
  readonly failure:
    | RepositoryPathRejected
    | RepositoryRejected
    | EnvironmentAccessFailure;
}> {}

export type RepositoryCatalogClientError =
  | RepositoryCatalogRejected
  | RepositoryCatalogResponseError;

export type RepositoryCatalogClient = EffectRoutesClient<
  typeof RepositoryCatalogHttpApi,
  RepositoryCatalogClientError
>;
