import type { IncomingMessage, ServerResponse } from "node:http";
import {
  RecordRepositoryOpened,
  RememberRepository,
  RemoveRepository,
  RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
  RepositoryCatalog as RepositoryCatalogSchema,
  RepositoryRemoved,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  readBearerCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function respondToRepositoryCatalogRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  catalog: RepositoryCatalog,
) {
  return Effect.gen(function* () {
    if (request.url === RepositoryCatalogHttpApi.list.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryCatalogHttpApi.list.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* requireEmptyBody(body);
      yield* authorization.authorize(
        readBearerCredential(request),
        "repository.read",
      );
      writeJson(
        response,
        RepositoryCatalogHttpApi.list.successStatus,
        RepositoryCatalogSchema,
        { repositories: yield* catalog.list() },
      );
      return true;
    }

    if (request.url === RepositoryCatalogHttpApi.remember.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryCatalogHttpApi.remember.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readBearerCredential(request),
        "repository.write",
      );
      const remembered = yield* catalog.remember(
        (yield* decodeRequestBody(RememberRepository, body)).path,
      );
      writeJson(
        response,
        RepositoryCatalogHttpApi.remember.successStatus,
        RepositoryCatalogEntry,
        remembered,
      );
      return true;
    }

    if (request.url === RepositoryCatalogHttpApi.recordOpened.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryCatalogHttpApi.recordOpened.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readBearerCredential(request),
        "repository.read",
      );
      const opened = yield* catalog.recordOpened(
        (yield* decodeRequestBody(RecordRepositoryOpened, body)).repositoryId,
      );
      writeJson(
        response,
        RepositoryCatalogHttpApi.recordOpened.successStatus,
        RepositoryCatalogEntry,
        opened,
      );
      return true;
    }

    if (request.url === RepositoryCatalogHttpApi.remove.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryCatalogHttpApi.remove.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readBearerCredential(request),
        "repository.write",
      );
      const removed = yield* catalog.remove(
        (yield* decodeRequestBody(RemoveRepository, body)).repositoryId,
      );
      writeJson(
        response,
        RepositoryCatalogHttpApi.remove.successStatus,
        RepositoryRemoved,
        removed,
      );
      return true;
    }

    return false;
  });
}

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
) {
  if (request.method === method) return Effect.void;
  return Effect.sync(() =>
    response.writeHead(405, { allow: method }).end(),
  ).pipe(Effect.andThen(Effect.interrupt));
}

function requireEmptyBody(body: Buffer) {
  return body.byteLength === 0 ? Effect.void : Effect.fail(invalidMessage());
}

function decodeRequestBody<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  body: Buffer,
) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(schema)(JSON.parse(body.toString("utf8")), {
        onExcessProperty: "error",
      }),
    catch: invalidMessage,
  });
}

function invalidMessage() {
  return new EnvironmentHttpBodyError({
    failure: { _tag: "InvalidMessage" },
  });
}
