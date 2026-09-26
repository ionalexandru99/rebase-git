import type {
  EnvironmentAccessFailure,
  PullFailure,
  RepositoryPullHttpApi,
  RepositoryRejected,
} from "@rebase/contracts";
import type { EnvironmentHttpRoutesClient } from "@rebase/environment-client";
import { Data } from "effect";

export class RepositoryPullRejected extends Data.TaggedError(
  "RepositoryPullRejected",
)<{
  readonly failure: PullFailure | RepositoryRejected | EnvironmentAccessFailure;
}> {}

export class RepositoryPullDisconnected extends Data.TaggedError(
  "RepositoryPullDisconnected",
) {}

export type RepositoryPullClient = EnvironmentHttpRoutesClient<
  typeof RepositoryPullHttpApi,
  RepositoryPullRejected | RepositoryPullDisconnected
>;
