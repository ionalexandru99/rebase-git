import type {
  EnvironmentAccessFailure,
  RepositoryCheckoutFailure,
  RepositoryRefsHttpApi,
  RepositoryRejected,
} from "@rebase/contracts";
import { Data } from "effect";
import type { EffectRoutesClient } from "#web/platform/environment/effect-routes-client";

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

export type RepositoryRefsClient = EffectRoutesClient<
  typeof RepositoryRefsHttpApi,
  RepositoryRefsClientError
>;
