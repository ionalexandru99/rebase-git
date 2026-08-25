import type { RepositoryCatalogHttpFailure } from "@rebase/contracts";
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
