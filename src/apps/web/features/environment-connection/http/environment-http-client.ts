import {
  currentClientReceiveLimits,
  EnvironmentAuthorizationHttpApi,
  type EnvironmentAuthorizationHttpFailure,
  EnvironmentBrowserSession,
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  EnvironmentPairingExchanged,
  type EnvironmentSnapshot,
  EnvironmentSnapshot as EnvironmentSnapshotSchema,
  EnvironmentWebSocketTicket,
  ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import {
  EnvironmentAuthorizationRejected,
  type EnvironmentResponseError,
  environmentResponseError,
} from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { environmentCredentialRequest } from "#web/features/environment-connection/http/environment-credential-request";
import { readBoundedEnvironmentResponseBody } from "#web/features/environment-connection/http/environment-http-response-body";

export function fetchEnvironmentDiscovery(
  origin: string,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    fetchEnvironmentDiscoveryEffect(origin),
    signal === undefined ? undefined : { signal },
  );
}

export function fetchEnvironmentDiscoveryEffect(origin: string) {
  return Effect.gen(function* () {
    const response = yield* fetchResponse(
      new URL(EnvironmentHttpApi.discovery.path, normalizeOrigin(origin)),
      EnvironmentHttpApi.discovery.method,
      "Discovery",
    );
    return yield* decodeResponse(
      response,
      EnvironmentDiscovery,
      EnvironmentHttpApi.discovery.failure,
      currentClientReceiveLimits.maxHttpResponseBytes,
      "Discovery",
    );
  });
}

export function fetchEnvironmentSnapshot(
  origin: string,
  discovery: EnvironmentDiscovery,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
): Promise<EnvironmentSnapshot> {
  return Effect.runPromise(
    fetchEnvironmentSnapshotEffect(origin, discovery, credential),
    signal === undefined ? undefined : { signal },
  );
}

export function fetchEnvironmentSnapshotEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
) {
  return fetchEnvironmentSnapshotWithinLimitEffect(
    origin,
    discovery,
    credential,
    Math.min(
      discovery.limits.maxHttpResponseBytes,
      currentClientReceiveLimits.maxHttpResponseBytes,
    ),
    signal,
  );
}

export function fetchEnvironmentSnapshotWithinLimit(
  origin: string,
  discovery: EnvironmentDiscovery,
  credential: EnvironmentCredential,
  maxResponseBytes: number,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    fetchEnvironmentSnapshotWithinLimitEffect(
      origin,
      discovery,
      credential,
      maxResponseBytes,
    ),
    signal === undefined ? undefined : { signal },
  );
}

export function fetchEnvironmentSnapshotWithinLimitEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  credential: EnvironmentCredential,
  maxResponseBytes: number,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const response = yield* fetchResponse(
      new URL(EnvironmentHttpApi.snapshot.path, normalizeOrigin(origin)),
      EnvironmentHttpApi.snapshot.method,
      "Snapshot",
      signal,
      environmentCredentialRequest(credential),
    );
    const snapshot = yield* decodeResponse(
      response,
      EnvironmentSnapshotSchema,
      EnvironmentHttpApi.snapshot.failure,
      maxResponseBytes,
      "Snapshot",
    );
    if (snapshot.environmentId !== discovery.environmentId) {
      return yield* Effect.fail(environmentResponseError("Snapshot"));
    }
    return snapshot;
  });
}

export function exchangeEnvironmentPairing(
  origin: string,
  exchange: typeof ExchangeEnvironmentPairing.Type,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    exchangeEnvironmentPairingEffect(origin, exchange),
    signal === undefined ? undefined : { signal },
  );
}

export function exchangeEnvironmentPairingEffect(
  origin: string,
  exchange: typeof ExchangeEnvironmentPairing.Type,
) {
  return Effect.gen(function* () {
    const response = yield* fetchResponse(
      new URL(
        EnvironmentAuthorizationHttpApi.exchangePairing.path,
        normalizeOrigin(origin),
      ),
      EnvironmentAuthorizationHttpApi.exchangePairing.method,
      "Authorization",
      undefined,
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          Schema.encodeSync(ExchangeEnvironmentPairing)(exchange),
        ),
      },
    );
    return yield* decodeResponse(
      response,
      EnvironmentPairingExchanged,
      EnvironmentAuthorizationHttpApi.exchangePairing.failure,
      currentClientReceiveLimits.maxHttpResponseBytes,
      "Authorization",
    );
  });
}

export function createEnvironmentBrowserSessionEffect(
  origin: string,
  exchange: typeof ExchangeEnvironmentPairing.Type,
) {
  const api = EnvironmentAuthorizationHttpApi.createBrowserSession;
  return fetchResponse(
    new URL(api.path, normalizeOrigin(origin)),
    api.method,
    "Authorization",
    undefined,
    {
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        Schema.encodeSync(ExchangeEnvironmentPairing)(exchange),
      ),
    },
  ).pipe(
    Effect.flatMap((response) =>
      decodeResponse(
        response,
        EnvironmentBrowserSession,
        api.failure,
        currentClientReceiveLimits.maxHttpResponseBytes,
        "Authorization",
      ),
    ),
  );
}

export function readEnvironmentBrowserSessionEffect(origin: string) {
  const api = EnvironmentAuthorizationHttpApi.readBrowserSession;
  return fetchResponse(
    new URL(api.path, normalizeOrigin(origin)),
    api.method,
    "Authorization",
    undefined,
    {
      credentials: "same-origin",
    },
  ).pipe(
    Effect.flatMap((response) =>
      decodeResponse(
        response,
        EnvironmentBrowserSession,
        api.failure,
        currentClientReceiveLimits.maxHttpResponseBytes,
        "Authorization",
      ),
    ),
  );
}

export function mintEnvironmentWebSocketTicketEffect(
  origin: string,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const response = yield* fetchResponse(
      new URL(
        EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path,
        normalizeOrigin(origin),
      ),
      EnvironmentAuthorizationHttpApi.mintWebSocketTicket.method,
      "Authorization",
      signal,
      environmentCredentialRequest(credential),
    );
    return yield* decodeResponse(
      response,
      EnvironmentWebSocketTicket,
      EnvironmentAuthorizationHttpApi.mintWebSocketTicket.failure,
      currentClientReceiveLimits.maxHttpResponseBytes,
      "Authorization",
    );
  });
}

function fetchResponse(
  url: URL,
  method: string,
  responseTag: EnvironmentResponseError["responseTag"],
  externalSignal?: AbortSignal,
  options: Pick<RequestInit, "headers" | "body" | "credentials"> = {},
) {
  return Effect.tryPromise({
    try: (effectSignal) =>
      fetch(url, {
        credentials: "omit",
        ...options,
        method,
        signal:
          externalSignal === undefined
            ? effectSignal
            : AbortSignal.any([effectSignal, externalSignal]),
      }),
    catch: () => environmentResponseError(responseTag),
  });
}

function decodeResponse<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<
    EnvironmentAuthorizationHttpFailure,
    never
  >,
>(
  response: Response,
  schema: S,
  failureSchema: F,
  byteLimit: number,
  responseTag: EnvironmentResponseError["responseTag"],
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const encoded = yield* readBoundedEnvironmentResponseBody(
        response,
        byteLimit,
      ).pipe(Effect.mapError(() => environmentResponseError(responseTag)));
      const json = yield* Effect.try({
        try: () => JSON.parse(encoded) as unknown,
        catch: () => environmentResponseError(responseTag),
      });
      if (!response.ok) {
        const failure = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(failureSchema)(json),
          catch: () => environmentResponseError(responseTag),
        });
        return yield* Effect.fail(
          new EnvironmentAuthorizationRejected({
            failure,
            status: response.status,
          }),
        );
      }
      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(json),
        catch: () => environmentResponseError(responseTag),
      });
    }),
  );
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
