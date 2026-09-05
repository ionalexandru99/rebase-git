import {
  EnvironmentDirectory,
  EnvironmentFilesystemHttpApi,
  ListEnvironmentDirectory,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import { requestEnvironmentJson } from "#web/features/environment-connection/http/environment-http-json";
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
    const request = yield* Effect.try({
      try: () => ({
        url: new URL(
          EnvironmentFilesystemHttpApi.listDirectory.path,
          normalizeOrigin(origin),
        ),
        body: JSON.stringify(
          Schema.encodeSync(ListEnvironmentDirectory)(
            path === undefined ? {} : { path },
          ),
        ),
      }),
      catch: () => new EnvironmentFilesystemResponseError(),
    });
    return yield* requestEnvironmentJson(
      request.url,
      EnvironmentFilesystemHttpApi.listDirectory.method,
      credential,
      EnvironmentDirectory,
      EnvironmentFilesystemHttpApi.listDirectory.failure,
      request.body,
    ).pipe(
      Effect.mapError((error) =>
        error._tag === "EnvironmentHttpRejected"
          ? new EnvironmentFilesystemRejected({
              failure: error.failure,
              status: error.status,
            })
          : new EnvironmentFilesystemResponseError(),
      ),
    );
  });
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
