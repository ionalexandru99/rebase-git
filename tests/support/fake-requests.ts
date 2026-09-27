import type {
  EnvironmentRoute,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { repositoryOperation } from "#tests-support/fixtures.ts";
import type { EnvironmentRequests } from "#web/platform/query/environment-context.tsx";
import type { RequestFailure } from "#web/platform/query/request-failure.ts";

interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface FakeRoute<Route extends EnvironmentRoute = EnvironmentRoute> {
  readonly route: Route;
  respond(
    input: RouteInput<Route>,
    options: RequestOptions,
  ): RouteSuccess<Route> | Promise<RouteSuccess<Route>>;
}

export function respond<Route extends EnvironmentRoute>(
  route: Route,
  handler: (
    input: RouteInput<Route>,
    options: RequestOptions,
  ) => RouteSuccess<Route> | Promise<RouteSuccess<Route>>,
): FakeRoute<Route> {
  return { route, respond: handler };
}

export function rejected<Failure>(failure: Failure): RequestFailure<Failure> {
  return { _tag: "Rejected", failure };
}

export const unanswered: RequestFailure<never> = { _tag: "Unanswered" };

export function fakeRequests(
  ...routes: readonly FakeRoute[]
): EnvironmentRequests {
  return async <Route extends EnvironmentRoute>(
    route: Route,
    input: RouteInput<Route>,
    options: RequestOptions = {},
  ) => {
    const fake = routes.find((candidate) => handles(candidate, route));
    if (fake === undefined)
      throw new Error(`Unexpected request to ${route._tag}`);
    return fake.respond(input, options);
  };
}

function handles<Route extends EnvironmentRoute>(
  fake: FakeRoute,
  route: Route,
): fake is FakeRoute<Route> {
  return fake.route === route;
}

export const idleOperation = respond(RepositoryOperationsApi.read, async () =>
  repositoryOperation(),
);
