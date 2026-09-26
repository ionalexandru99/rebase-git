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

export interface FakeRoute<
  Route extends
    RequestableEnvironmentHttpRoute = RequestableEnvironmentHttpRoute,
> {
  readonly route: Route;
  respond(
    input: RouteInput<Route>,
    options: EnvironmentRequestOptions,
  ): RouteSuccess<Route> | Promise<RouteSuccess<Route>>;
}

export function respond<Route extends RequestableEnvironmentHttpRoute>(
  route: Route,
  handler: (
    input: RouteInput<Route>,
    options: EnvironmentRequestOptions,
  ) => RouteSuccess<Route> | Promise<RouteSuccess<Route>>,
): FakeRoute<Route> {
  return { route, respond: handler };
}

export function fakeRequests(
  ...routes: readonly FakeRoute[]
): EnvironmentRequestClient {
  return async <Route extends RequestableEnvironmentHttpRoute>(
    route: Route,
    input: RouteInput<Route>,
    options: EnvironmentRequestOptions = {},
  ) => {
    const fake = routes.find((candidate) => handles(candidate, route));
    if (fake === undefined)
      throw new Error(`Unexpected request to ${route.path}`);
    return fake.respond(input, options);
  };
}

function handles<Route extends RequestableEnvironmentHttpRoute>(
  fake: FakeRoute,
  route: Route,
): fake is FakeRoute<Route> {
  return fake.route === route;
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
