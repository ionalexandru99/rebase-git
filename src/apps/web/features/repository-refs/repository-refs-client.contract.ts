import type { RepositoryRefsHttpFailure } from "@rebase/contracts";
import { Data } from "effect";

export class RepositoryRefsResponseError extends Data.TaggedError(
  "RepositoryRefsResponseError",
) {}

export class RepositoryRefsRejected extends Data.TaggedError(
  "RepositoryRefsRejected",
)<{
  readonly failure: RepositoryRefsHttpFailure;
  readonly status: number;
}> {}

export type RepositoryRefsClientError =
  | RepositoryRefsRejected
  | RepositoryRefsResponseError;
