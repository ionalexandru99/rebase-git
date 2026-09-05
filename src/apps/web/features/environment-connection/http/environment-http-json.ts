import { currentClientReceiveLimits } from "@rebase/contracts";
import { Effect, Schema } from "effect";
import {
  EnvironmentHttpRejected,
  EnvironmentHttpResponseError,
} from "#web/features/environment-connection/http/environment-http-json.contract";
import { readBoundedEnvironmentResponseBody } from "#web/features/environment-connection/http/environment-http-response-body";

export function requestEnvironmentJson<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<unknown, never>,
>(
  url: URL,
  method: string,
  credential: string,
  successSchema: S,
  failureSchema: F,
  body?: string,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          ...(body === undefined ? {} : { body }),
          headers: {
            authorization: `Bearer ${credential}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          method,
          signal,
        }),
      catch: () => new EnvironmentHttpResponseError(),
    });
    return yield* decodeResponse(response, successSchema, failureSchema);
  });
}

function decodeResponse<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<unknown, never>,
>(response: Response, successSchema: S, failureSchema: F) {
  return Effect.scoped(
    Effect.gen(function* () {
      const encoded = yield* readBoundedEnvironmentResponseBody(
        response,
        currentClientReceiveLimits.maxHttpResponseBytes,
      ).pipe(Effect.mapError(() => new EnvironmentHttpResponseError()));
      const json = yield* Effect.try({
        try: () => JSON.parse(encoded) as unknown,
        catch: () => new EnvironmentHttpResponseError(),
      });
      if (!response.ok) {
        const failure = yield* decodeValue(failureSchema, json);
        return yield* Effect.fail(
          new EnvironmentHttpRejected({ failure, status: response.status }),
        );
      }
      return yield* decodeValue(successSchema, json);
    }),
  );
}

function decodeValue<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown,
) {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: () => new EnvironmentHttpResponseError(),
  });
}
