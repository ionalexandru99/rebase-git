import type { PullHttpFailure, RepositoryPullHttpApi } from "@rebase/contracts";
import type { EnvironmentHttpRoutesClient } from "@rebase/environment-client";
import { Data } from "effect";

export class RepositoryPullRejected extends Data.TaggedError(
  "RepositoryPullRejected",
)<{ readonly failure: PullHttpFailure }> {}

export class RepositoryPullDisconnected extends Data.TaggedError(
  "RepositoryPullDisconnected",
) {}

export type RepositoryPullClient = EnvironmentHttpRoutesClient<
  typeof RepositoryPullHttpApi,
  RepositoryPullRejected | RepositoryPullDisconnected
>;
