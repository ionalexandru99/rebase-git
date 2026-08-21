import {
  currentClientReceiveLimits,
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  type EnvironmentSnapshot,
  EnvironmentSnapshot as EnvironmentSnapshotSchema,
} from "@rebase/contracts";
import {
  type EnvironmentResponseError,
  environmentResponseError,
} from "@rebase/web/state/server/environment-connection/environment-connection-errors";
import { readBoundedEnvironmentResponseBody } from "@rebase/web/state/server/environment-connection/http/environment-http-response-body";
import { Effect, Schema } from "effect";

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
      currentClientReceiveLimits.maxHttpResponseBytes,
      "Discovery",
    );
  });
}

export function fetchEnvironmentSnapshot(
  origin: string,
  discovery: EnvironmentDiscovery,
  signal?: AbortSignal,
): Promise<EnvironmentSnapshot> {
  return Effect.runPromise(
    fetchEnvironmentSnapshotEffect(origin, discovery),
    signal === undefined ? undefined : { signal },
  );
}

export function fetchEnvironmentSnapshotEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  signal?: AbortSignal,
) {
  return fetchEnvironmentSnapshotWithinLimitEffect(
    origin,
    discovery,
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
  maxResponseBytes: number,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    fetchEnvironmentSnapshotWithinLimitEffect(
      origin,
      discovery,
      maxResponseBytes,
    ),
    signal === undefined ? undefined : { signal },
  );
}

export function fetchEnvironmentSnapshotWithinLimitEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  maxResponseBytes: number,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const response = yield* fetchResponse(
      new URL(EnvironmentHttpApi.snapshot.path, normalizeOrigin(origin)),
      EnvironmentHttpApi.snapshot.method,
      "Snapshot",
      signal,
    );
    const snapshot = yield* decodeResponse(
      response,
      EnvironmentSnapshotSchema,
      maxResponseBytes,
      "Snapshot",
    );
    if (snapshot.environmentId !== discovery.environmentId) {
      return yield* Effect.fail(environmentResponseError("Snapshot"));
    }
    return snapshot;
  });
}

function fetchResponse(
  url: URL,
  method: string,
  responseTag: EnvironmentResponseError["responseTag"],
  externalSignal?: AbortSignal,
) {
  return Effect.tryPromise({
    try: (effectSignal) =>
      fetch(url, {
        method,
        signal:
          externalSignal === undefined
            ? effectSignal
            : AbortSignal.any([effectSignal, externalSignal]),
      }),
    catch: () => environmentResponseError(responseTag),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(environmentResponseError(responseTag)),
    ),
  );
}

function decodeResponse<S extends Schema.ConstraintDecoder<unknown, never>>(
  response: Response,
  schema: S,
  byteLimit: number,
  responseTag: EnvironmentResponseError["responseTag"],
) {
  return Effect.scoped(
    readBoundedEnvironmentResponseBody(response, byteLimit),
  ).pipe(
    Effect.flatMap((encoded) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(JSON.parse(encoded)),
        catch: () => environmentResponseError(responseTag),
      }),
    ),
    Effect.mapError(() => environmentResponseError(responseTag)),
  );
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
