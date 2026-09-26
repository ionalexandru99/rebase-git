import type {
  EnvironmentAccessFailure,
  RepositoryCheckoutFailure,
  RepositoryRefsHttpApi,
  RepositoryRejected,
} from "@rebase/contracts";
import type { EnvironmentHttpRoutesClient } from "@rebase/environment-client";
import { Data } from "effect";

export class RepositoryRefsResponseError extends Data.TaggedError(
  "RepositoryRefsResponseError",
) {}

export class RepositoryRefsRejected extends Data.TaggedError(
  "RepositoryRefsRejected",
)<{
  readonly failure:
    | RepositoryCheckoutFailure
    | RepositoryRejected
    | EnvironmentAccessFailure;
}> {}

export type RepositoryRefsClientError =
  | RepositoryRefsRejected
  | RepositoryRefsResponseError;

export type RepositoryRefsClient = EnvironmentHttpRoutesClient<
  typeof RepositoryRefsHttpApi,
  RepositoryRefsClientError
>;
