import {
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
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { requestEnvironmentJson } from "#web/features/environment-connection/http/environment-http-json";
import {
  RepositoryCatalogRejected,
  RepositoryCatalogResponseError,
} from "#web/features/repository-catalog/repository-catalog-client.contract";

export function listEnvironmentRepositoriesEffect(
  origin: string,
  credential: EnvironmentCredential,
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

export function rememberEnvironmentRepositoryEffect(
  origin: string,
  credential: EnvironmentCredential,
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

export function recordEnvironmentRepositoryOpenedEffect(
  origin: string,
  credential: EnvironmentCredential,
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

export function removeEnvironmentRepositoryEffect(
  origin: string,
  credential: EnvironmentCredential,
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
  credential: EnvironmentCredential,
  successSchema: S,
  failureSchema: F,
  body?: string,
) {
  return Effect.try({
    try: () => new URL(path, normalizeOrigin(origin)),
    catch: () => new RepositoryCatalogResponseError(),
  }).pipe(
    Effect.flatMap((url) =>
      requestEnvironmentJson(
        url,
        method,
        credential,
        successSchema,
        failureSchema,
        body,
      ),
    ),
    Effect.mapError((error) =>
      error._tag === "EnvironmentHttpRejected"
        ? new RepositoryCatalogRejected({
            failure: error.failure,
            status: error.status,
          })
        : new RepositoryCatalogResponseError(),
    ),
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
