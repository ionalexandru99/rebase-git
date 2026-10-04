import { Effect } from "effect";
import type { PullRequestsUnavailable } from "#contracts/pull-requests/pull-requests.contract.ts";
import {
  type HostResponse,
  hostGet,
  unavailable,
} from "#server/features/source-control/git-host.ts";

export interface BitbucketClient {
  readonly get: (
    url: string,
    authorization: string,
  ) => Effect.Effect<HostResponse, PullRequestsUnavailable>;
}

export const bitbucketApi = "https://api.bitbucket.org/2.0";

export function createBitbucketClient(): BitbucketClient {
  return { get: (url, authorization) => hostGet(url, { authorization }) };
}

export function readJson<A>(
  client: BitbucketClient,
  authorization: string,
  url: string,
  decode: (body: string) => Effect.Effect<A, unknown>,
): Effect.Effect<A, PullRequestsUnavailable> {
  return client.get(url, authorization).pipe(
    Effect.flatMap(({ status, body }) =>
      status === 200 ? decode(body) : Effect.fail(unavailable),
    ),
    Effect.mapError(() => unavailable),
  );
}
