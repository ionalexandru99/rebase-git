import {
  currentClientReceiveLimits,
  EnvironmentDirectory,
  EnvironmentFilesystemHttpApi,
  type EnvironmentFilesystemHttpFailure,
  ListEnvironmentDirectory,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import { readBoundedEnvironmentResponseBody } from "#web/features/environment-connection/http/environment-http-response-body";
import {
  EnvironmentFilesystemRejected,
  EnvironmentFilesystemResponseError,
} from "#web/features/environment-filesystem/environment-filesystem-client.contract";

export function listEnvironmentDirectoryEffect(
  origin: string,
  credential: string,
  path?: string,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(
          new URL(
            EnvironmentFilesystemHttpApi.listDirectory.path,
            normalizeOrigin(origin),
          ),
          {
            body: JSON.stringify(
              Schema.encodeSync(ListEnvironmentDirectory)(
                path === undefined ? {} : { path },
              ),
            ),
            headers: {
              authorization: `Bearer ${credential}`,
              "content-type": "application/json",
            },
            method: EnvironmentFilesystemHttpApi.listDirectory.method,
            signal,
          },
        ),
      catch: () => new EnvironmentFilesystemResponseError(),
    });
    return yield* decodeResponse(response);
  });
}

function decodeResponse(response: Response) {
  return Effect.scoped(
    Effect.gen(function* () {
      const encoded = yield* readBoundedEnvironmentResponseBody(
        response,
        currentClientReceiveLimits.maxHttpResponseBytes,
      ).pipe(Effect.mapError(() => new EnvironmentFilesystemResponseError()));
      const json = yield* Effect.try({
        try: () => JSON.parse(encoded) as unknown,
        catch: () => new EnvironmentFilesystemResponseError(),
      });
      if (!response.ok) {
        const failure = yield* decodeFailure(json);
        return yield* Effect.fail(
          new EnvironmentFilesystemRejected({
            failure,
            status: response.status,
          }),
        );
      }
      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(EnvironmentDirectory)(json),
        catch: () => new EnvironmentFilesystemResponseError(),
      });
    }),
  );
}

function decodeFailure(json: unknown) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(
        EnvironmentFilesystemHttpApi.listDirectory.failure,
      )(json) satisfies EnvironmentFilesystemHttpFailure,
    catch: () => new EnvironmentFilesystemResponseError(),
  });
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
