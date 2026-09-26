import {
  currentClientReceiveLimits,
  EnvironmentAuthorizationHttpApi,
  type EnvironmentDiscovery,
  EnvironmentHttpApi,
  type ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import { absurd, Effect } from "effect";
import {
  type EnvironmentAccessDenied,
  type EnvironmentHttpRejected,
  type EnvironmentResponseError,
  environmentResponseError,
} from "#environment-client/environment-connection-errors";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import { requestEnvironmentHttp } from "#environment-client/http/environment-http-request";

const browserSession: EnvironmentCredential = { type: "browser-session" };

type AlwaysAccepted<A> = Effect.Effect<
  A,
  | EnvironmentResponseError
  | EnvironmentAccessDenied
  | EnvironmentHttpRejected<never>
>;

function accepted<A>(request: AlwaysAccepted<A>) {
  return request.pipe(
    Effect.catchTag("EnvironmentHttpRejected", (rejected) =>
      absurd<Effect.Effect<A>>(rejected.failure),
    ),
  );
}

export function fetchEnvironmentDiscoveryEffect(origin: string) {
  return accepted(
    requestEnvironmentHttp(origin, EnvironmentHttpApi.discovery, {
      command: undefined,
    }),
  );
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
  return accepted(
    requestEnvironmentHttp(origin, EnvironmentHttpApi.snapshot, {
      command: undefined,
      credential,
      maxResponseBytes:
        options.maxResponseBytes ??
        Math.min(
          discovery.limits.maxHttpResponseBytes,
          currentClientReceiveLimits.maxHttpResponseBytes,
        ),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  ).pipe(
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
  return accepted(
    requestEnvironmentHttp(
      origin,
      EnvironmentAuthorizationHttpApi.exchangePairing,
      { command: exchange },
    ),
  );
}

export function createEnvironmentBrowserSessionEffect(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  return accepted(
    requestEnvironmentHttp(
      origin,
      EnvironmentAuthorizationHttpApi.createBrowserSession,
      { command: exchange, credential: browserSession },
    ),
  );
}

export function readEnvironmentBrowserSessionEffect(origin: string) {
  return accepted(
    requestEnvironmentHttp(
      origin,
      EnvironmentAuthorizationHttpApi.readBrowserSession,
      { command: undefined, credential: browserSession },
    ),
  );
}

export function mintEnvironmentWebSocketTicketEffect(
  origin: string,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
) {
  return accepted(
    requestEnvironmentHttp(
      origin,
      EnvironmentAuthorizationHttpApi.mintWebSocketTicket,
      {
        command: undefined,
        credential,
        ...(signal === undefined ? {} : { signal }),
      },
    ),
  );
}
