import type { RouteFailure, RouteInput, RouteSuccess } from "@rebase/contracts";
import type {
  EnvironmentAccessDenied,
  EnvironmentHttpRejected,
  EnvironmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { RequestableEnvironmentHttpRoute } from "#environment-client/http/environment-http-request.contract";

export type EnvironmentRequestFailure<Failure> =
  | EnvironmentResponseError
  | EnvironmentAccessDenied
  | EnvironmentHttpRejected<Failure>;

export type EnvironmentRouteFailure<
  Route extends RequestableEnvironmentHttpRoute,
> = EnvironmentRequestFailure<RouteFailure<Route>>;

export interface EnvironmentRequestOptions {
  readonly signal?: AbortSignal;
}

export type EnvironmentRequestClient = <
  Route extends RequestableEnvironmentHttpRoute,
>(
  route: Route,
  input: RouteInput<Route>,
  options?: EnvironmentRequestOptions,
) => Promise<RouteSuccess<Route>>;
