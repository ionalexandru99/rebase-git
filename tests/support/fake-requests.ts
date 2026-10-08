import type {
  EnvironmentRoute,
  EnvironmentStreamRoute,
  RouteInput,
  RouteSuccess,
  StreamValue,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { repositoryOperation } from "#tests-support/fixtures.ts";
import type {
  EnvironmentRequests,
  EnvironmentSubscriptions,
  RequestOptions,
} from "#web/platform/query/environment-context.tsx";
import type { RequestFailure } from "#web/platform/query/request-failure.ts";

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

export const noSubscriptions: EnvironmentSubscriptions = async (route) => {
  throw new Error(`Unexpected subscription to ${route._tag}`);
};

export function fakeSubscription<Route extends EnvironmentStreamRoute>(
  route: Route,
  values: readonly StreamValue<Route>[],
) {
  const inputs: RouteInput<Route>[] = [];
  const subscribe: EnvironmentSubscriptions = async (
    requested,
    input,
    accept,
    signal,
  ) => {
    if (requested._tag !== route._tag)
      throw new Error(`Unexpected subscription to ${requested._tag}`);
    inputs.push(input as RouteInput<Route>);
    for (const value of values) accept(value as never);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  return { subscribe, inputs };
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
