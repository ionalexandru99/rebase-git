import {
  currentClientReceiveLimits,
  EnvironmentAuthorizationHttpApi,
  type EnvironmentDiscovery,
  EnvironmentHttpApi,
  type ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import { Effect } from "effect";
import { environmentResponseError } from "#environment-client/environment-connection-errors";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";
import { requestEnvironmentHttp } from "#environment-client/http/environment-http-request";

const browserSession: EnvironmentCredential = { type: "browser-session" };

export function fetchEnvironmentDiscoveryEffect(origin: string) {
  return requestEnvironmentHttp(origin, EnvironmentHttpApi.discovery, {
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
  return requestEnvironmentHttp(origin, EnvironmentHttpApi.snapshot, {
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
  return requestEnvironmentHttp(
    origin,
    EnvironmentAuthorizationHttpApi.exchangePairing,
    { command: exchange },
  );
}

export function createEnvironmentBrowserSessionEffect(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  return requestEnvironmentHttp(
    origin,
    EnvironmentAuthorizationHttpApi.createBrowserSession,
    { command: exchange, credential: browserSession },
  );
}

export function readEnvironmentBrowserSessionEffect(origin: string) {
  return requestEnvironmentHttp(
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
  return requestEnvironmentHttp(
    origin,
    EnvironmentAuthorizationHttpApi.mintWebSocketTicket,
    {
      command: undefined,
      credential,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}
