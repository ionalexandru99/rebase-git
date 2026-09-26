import {
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
  type RouteInput,
  type RouteSuccess,
} from "@rebase/contracts";
import type {
  EnvironmentRequestClient,
  EnvironmentRequestOptions,
  RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";

export interface FakeRoute {
  readonly path: string;
  readonly respond: (
    input: unknown,
    options: EnvironmentRequestOptions,
  ) => unknown;
}

export function respond<Route extends RequestableEnvironmentHttpRoute>(
  route: Route,
  handler: (
    input: RouteInput<Route>,
    options: EnvironmentRequestOptions,
  ) => RouteSuccess<Route> | Promise<RouteSuccess<Route>>,
): FakeRoute {
  return {
    path: route.path,
    respond: (input, options) => handler(input as RouteInput<Route>, options),
  };
}

export function fakeRequests(
  ...routes: readonly FakeRoute[]
): EnvironmentRequestClient {
  return async <Route extends RequestableEnvironmentHttpRoute>(
    route: Route,
    input: RouteInput<Route>,
    options: EnvironmentRequestOptions = {},
  ) => {
    const fake = routes.find((candidate) => candidate.path === route.path);
    if (fake === undefined)
      throw new Error(`Unexpected request to ${route.path}`);
    return (await fake.respond(input, options)) as RouteSuccess<Route>;
  };
}

export const idleOperation = respond(
  RepositoryOperationsHttpApi.read,
  async (): Promise<RepositoryOperation> => ({
    kind: "idle",
    phase: "idle",
    revision: "idle",
    branch: null,
    commit: null,
    progress: null,
    unresolvedPaths: [],
    actions: [],
    lock: null,
  }),
);
