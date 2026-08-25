import {
  currentClientReceiveLimits,
  RecordRepositoryOpened,
  RememberRepository,
  RemoveRepository,
  RepositoryCatalog,
  type RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
  type RepositoryCatalogHttpFailure,
  RepositoryRemoved,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import { readBoundedEnvironmentResponseBody } from "#web/features/environment-connection/http/environment-http-response-body";
import {
  RepositoryCatalogRejected,
  RepositoryCatalogResponseError,
} from "#web/features/repository-catalog/repository-catalog-client.contract";

export function listEnvironmentRepositories(
  origin: string,
  credential: string,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    listEnvironmentRepositoriesEffect(origin, credential),
    signal === undefined ? undefined : { signal },
  );
}

export function listEnvironmentRepositoriesEffect(
  origin: string,
  credential: string,
) {
  return requestRepositoryCatalog(
    origin,
    RepositoryCatalogHttpApi.list.path,
    RepositoryCatalogHttpApi.list.method,
    credential,
    RepositoryCatalog,
    RepositoryCatalogHttpApi.list.failure,
  ).pipe(Effect.map((catalog) => catalog.repositories));
}

export function rememberEnvironmentRepository(
  origin: string,
  credential: string,
  path: string,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    rememberEnvironmentRepositoryEffect(origin, credential, path),
    signal === undefined ? undefined : { signal },
  );
}

export function rememberEnvironmentRepositoryEffect(
  origin: string,
  credential: string,
  path: string,
) {
  return requestRepositoryCatalog(
    origin,
    RepositoryCatalogHttpApi.remember.path,
    RepositoryCatalogHttpApi.remember.method,
    credential,
    RepositoryCatalogHttpApi.remember.success,
    RepositoryCatalogHttpApi.remember.failure,
    encodeRequest(RememberRepository, { path }),
  );
}

export function recordEnvironmentRepositoryOpened(
  origin: string,
  credential: string,
  repositoryId: string,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    recordEnvironmentRepositoryOpenedEffect(origin, credential, repositoryId),
    signal === undefined ? undefined : { signal },
  );
}

export function recordEnvironmentRepositoryOpenedEffect(
  origin: string,
  credential: string,
  repositoryId: string,
) {
  return requestRepositoryCatalog(
    origin,
    RepositoryCatalogHttpApi.recordOpened.path,
    RepositoryCatalogHttpApi.recordOpened.method,
    credential,
    RepositoryCatalogHttpApi.recordOpened.success,
    RepositoryCatalogHttpApi.recordOpened.failure,
    encodeRequest(RecordRepositoryOpened, { repositoryId }),
  );
}

export function removeEnvironmentRepository(
  origin: string,
  credential: string,
  repositoryId: string,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    removeEnvironmentRepositoryEffect(origin, credential, repositoryId),
    signal === undefined ? undefined : { signal },
  );
}

export function removeEnvironmentRepositoryEffect(
  origin: string,
  credential: string,
  repositoryId: string,
) {
  return requestRepositoryCatalog(
    origin,
    RepositoryCatalogHttpApi.remove.path,
    RepositoryCatalogHttpApi.remove.method,
    credential,
    RepositoryRemoved,
    RepositoryCatalogHttpApi.remove.failure,
    encodeRequest(RemoveRepository, { repositoryId }),
  );
}

function requestRepositoryCatalog<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<RepositoryCatalogHttpFailure, never>,
>(
  origin: string,
  path: string,
  method: string,
  credential: string,
  successSchema: S,
  failureSchema: F,
  body?: string,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(new URL(path, normalizeOrigin(origin)), {
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
      catch: () => new RepositoryCatalogResponseError(),
    });
    return yield* decodeResponse(response, successSchema, failureSchema);
  });
}

function decodeResponse<
  S extends Schema.ConstraintDecoder<unknown, never>,
  F extends Schema.ConstraintDecoder<RepositoryCatalogHttpFailure, never>,
>(response: Response, successSchema: S, failureSchema: F) {
  return Effect.scoped(
    Effect.gen(function* () {
      const encoded = yield* readBoundedEnvironmentResponseBody(
        response,
        currentClientReceiveLimits.maxHttpResponseBytes,
      ).pipe(Effect.mapError(() => new RepositoryCatalogResponseError()));
      const json = yield* Effect.try({
        try: () => JSON.parse(encoded) as unknown,
        catch: () => new RepositoryCatalogResponseError(),
      });
      if (!response.ok) {
        const failure = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(failureSchema)(json),
          catch: () => new RepositoryCatalogResponseError(),
        });
        return yield* Effect.fail(
          new RepositoryCatalogRejected({
            failure,
            status: response.status,
          }),
        );
      }
      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(successSchema)(json),
        catch: () => new RepositoryCatalogResponseError(),
      });
    }),
  );
}

function encodeRequest<S extends Schema.ConstraintEncoder<unknown, never>>(
  schema: S,
  value: S["Type"],
) {
  return JSON.stringify(Schema.encodeSync(schema)(value));
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}

export type { RepositoryCatalogEntry };
