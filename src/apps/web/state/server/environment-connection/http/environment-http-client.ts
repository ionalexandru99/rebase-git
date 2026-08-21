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
  return Effect.scoped(readBoundedResponse(response, byteLimit)).pipe(
    Effect.flatMap((encoded) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(JSON.parse(encoded)),
        catch: () => environmentResponseError(responseTag),
      }),
    ),
    Effect.mapError(() => environmentResponseError(responseTag)),
  );
}

function readBoundedResponse(response: Response, byteLimit: number) {
  return Effect.gen(function* () {
    const bodyStream = response.body;
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (bodyStream === null) {
      return yield* Effect.fail(new ResponseLimitExceeded());
    }
    if (declaredLength > byteLimit) {
      yield* Effect.tryPromise(() => bodyStream.cancel()).pipe(Effect.ignore);
      return yield* Effect.fail(new ResponseLimitExceeded());
    }

    const reader = yield* Effect.acquireRelease(
      Effect.sync(() => bodyStream.getReader()),
      (acquiredReader) =>
        Effect.tryPromise(() => acquiredReader.cancel()).pipe(
          Effect.ignore,
          Effect.andThen(
            Effect.try(() => acquiredReader.releaseLock()).pipe(Effect.ignore),
          ),
        ),
    );
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const next = yield* Effect.tryPromise(() => reader.read());
      if (next.done) {
        break;
      }
      byteLength += next.value.byteLength;
      if (byteLength > byteLimit) {
        return yield* Effect.fail(new ResponseLimitExceeded());
      }
      chunks.push(next.value);
    }

    const body = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  });
}

class ResponseLimitExceeded extends Error {}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
