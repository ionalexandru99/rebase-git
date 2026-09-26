import {
  currentClientReceiveLimits,
  EnvironmentAuthorizationHttpApi,
  type EnvironmentDiscovery,
  EnvironmentHttpApi,
  type ExchangeEnvironmentPairing,
  type RouteSuccess,
} from "@rebase/contracts";
import { Effect } from "effect";
import {
  EnvironmentAccessDenied,
  type EnvironmentResponseError,
  environmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import { requestEnvironmentHttp } from "#environment-client/http/environment-http-request";
import type {
  EnvironmentHttpRequestOptions,
  RequestableEnvironmentHttpRoute,
} from "#environment-client/http/environment-http-request.contract";

const browserSession: EnvironmentCredential = { type: "browser-session" };

export function fetchEnvironmentDiscoveryEffect(origin: string) {
  return requestEnvironmentEffect(origin, EnvironmentHttpApi.discovery, {
    command: undefined,
  });
}

export function fetchEnvironmentSnapshotEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  credential: EnvironmentCredential,
  options: {
    readonly maxResponseBytes?: number;
    readonly signal?: AbortSignal;
  } = {},
) {
  return requestEnvironmentEffect(origin, EnvironmentHttpApi.snapshot, {
    command: undefined,
    credential,
    maxResponseBytes:
      options.maxResponseBytes ??
      Math.min(
        discovery.limits.maxHttpResponseBytes,
        currentClientReceiveLimits.maxHttpResponseBytes,
      ),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }).pipe(
    Effect.filterOrFail(
      (snapshot) => snapshot.environmentId === discovery.environmentId,
      () => environmentResponseError(EnvironmentHttpApi.snapshot.path),
    ),
  );
}

export function exchangeEnvironmentPairingEffect(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  return requestEnvironmentEffect(
    origin,
    EnvironmentAuthorizationHttpApi.exchangePairing,
    { command: exchange },
  );
}

export function createEnvironmentBrowserSessionEffect(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  return requestEnvironmentEffect(
    origin,
    EnvironmentAuthorizationHttpApi.createBrowserSession,
    { command: exchange, credential: browserSession },
  );
}

export function readEnvironmentBrowserSessionEffect(origin: string) {
  return requestEnvironmentEffect(
    origin,
    EnvironmentAuthorizationHttpApi.readBrowserSession,
    { command: undefined, credential: browserSession },
  );
}

export function mintEnvironmentWebSocketTicketEffect(
  origin: string,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
) {
  return requestEnvironmentEffect(
    origin,
    EnvironmentAuthorizationHttpApi.mintWebSocketTicket,
    {
      command: undefined,
      credential,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

function requestEnvironmentEffect<
  Route extends RequestableEnvironmentHttpRoute,
>(
  origin: string,
  route: Route,
  options: EnvironmentHttpRequestOptions<Route>,
): Effect.Effect<
  RouteSuccess<Route>,
  EnvironmentResponseError | EnvironmentAccessDenied
> {
  return Effect.tryPromise({
    try: (signal) =>
      requestEnvironmentHttp(origin, route, {
        ...options,
        signal:
          options.signal === undefined
            ? signal
            : AbortSignal.any([signal, options.signal]),
      }),
    catch: (error) =>
      error instanceof EnvironmentAccessDenied
        ? error
        : environmentResponseError(route.path),
  });
}
