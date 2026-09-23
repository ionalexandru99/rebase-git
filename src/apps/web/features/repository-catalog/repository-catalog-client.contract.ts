import type {
  RepositoryCatalogHttpApi,
  RepositoryCatalogHttpFailure,
} from "@rebase/contracts";
import type { EnvironmentHttpRoutesClient } from "@rebase/environment-client";
import { Data } from "effect";

export class RepositoryCatalogResponseError extends Data.TaggedError(
  "RepositoryCatalogResponseError",
) {}

export class RepositoryCatalogRejected extends Data.TaggedError(
  "RepositoryCatalogRejected",
)<{
  readonly failure: RepositoryCatalogHttpFailure;
  readonly status: number;
}> {}

export type RepositoryCatalogClientError =
  | RepositoryCatalogRejected
  | RepositoryCatalogResponseError;

export type RepositoryCatalogClient = EnvironmentHttpRoutesClient<
  typeof RepositoryCatalogHttpApi,
  RepositoryCatalogClientError
>;
