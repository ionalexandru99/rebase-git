import type {
  EnvironmentHttpRouteFailure,
  EnvironmentHttpRouteFailureOptions,
  EnvironmentHttpRouteHandle,
  EnvironmentHttpRouteHandler,
  EnvironmentHttpRouteOptions,
  ServableEnvironmentHttpRoute,
} from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";

export function httpRoute<Route extends ServableEnvironmentHttpRoute>(
  route: Route,
  handle: EnvironmentHttpRouteHandle<Route, never>,
  options?: EnvironmentHttpRouteOptions,
): EnvironmentHttpRouteHandler;
export function httpRoute<
  Route extends ServableEnvironmentHttpRoute,
  Failure extends EnvironmentHttpRouteFailure,
>(
  route: Route,
  handle: EnvironmentHttpRouteHandle<Route, Failure>,
  options: EnvironmentHttpRouteFailureOptions<Route, Failure>,
): EnvironmentHttpRouteHandler;
export function httpRoute<
  Route extends ServableEnvironmentHttpRoute,
  Failure extends EnvironmentHttpRouteFailure,
>(
  route: Route,
  handle: EnvironmentHttpRouteHandle<Route, Failure>,
  options?: Partial<EnvironmentHttpRouteFailureOptions<Route, Failure>>,
): EnvironmentHttpRouteHandler {
  return {
    route,
    requiresOrigin: options?.requiresOrigin ?? false,
    handle,
    ...(options?.failureStatus === undefined
      ? {}
      : { failureStatus: options.failureStatus }),
  };
}
