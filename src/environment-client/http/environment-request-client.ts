import {
  EnvironmentAccessDenied,
  EnvironmentHttpRejected,
  EnvironmentResponseError,
  environmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import { requestEnvironmentHttp } from "#environment-client/http/environment-http-request";
import type { RequestableEnvironmentHttpRoute } from "#environment-client/http/environment-http-request.contract";
import type {
  EnvironmentRequestClient,
  EnvironmentRouteFailure,
} from "#environment-client/http/environment-request-client.contract";

export function createEnvironmentRequestClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): EnvironmentRequestClient {
  return async (route, command, options) => {
    const authorized = credential();
    if (authorized === undefined) throw environmentResponseError(route.path);
    return requestEnvironmentHttp(origin, route, {
      command,
      credential: authorized,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  };
}

export function environmentRouteFailure<
  Route extends RequestableEnvironmentHttpRoute,
>(route: Route, error: unknown): EnvironmentRouteFailure<Route> {
  if (
    error instanceof EnvironmentHttpRejected ||
    error instanceof EnvironmentAccessDenied ||
    error instanceof EnvironmentResponseError
  )
    return error;
  return environmentResponseError(route.path);
}
