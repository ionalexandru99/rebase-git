import type { IncomingMessage, ServerResponse } from "node:http";
import {
  RecordRepositoryOpened,
  RememberRepository,
  RemoveRepository,
  RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
  RepositoryCatalogOperationFailure,
  RepositoryCatalog as RepositoryCatalogSchema,
  RepositoryRemoved,
} from "@rebase/contracts";
import { Effect } from "effect";
import type {
  RepositoryCatalog,
  RepositoryCatalogError,
} from "#server/domain/repository-catalog.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  readRequestCredential,
  validateRequestOrigin,
} from "#server/adapters/environment-transport/environment-request-authorization";
import type { EnvironmentHttpRequestHandler } from "#server/adapters/environment-transport/http/environment-http-handler.contract";
import {
  decodeRequestBody,
  requireEmptyBody,
  requireMethod,
} from "#server/adapters/environment-transport/http/environment-http-request-validation";
import { writeJson } from "#server/adapters/environment-transport/http/environment-http-response";

export function createRepositoryCatalogHttpHandler(
  authorization: EnvironmentAuthorization,
  catalog: RepositoryCatalog,
): EnvironmentHttpRequestHandler {
  return (request, response, body) =>
    respondToRepositoryCatalogRequest(
      request,
      response,
      body,
      authorization,
      catalog,
    ).pipe(
      Effect.catchTag("RepositoryCatalogError", (error) =>
        Effect.sync(() => {
          writeJson(
            response,
            failureStatus(error),
            RepositoryCatalogOperationFailure,
            error.failure,
          );
          return true;
        }),
      ),
    );
}

function failureStatus(error: RepositoryCatalogError) {
  if (error.failure._tag === "RepositoryMissing") {
    return 404;
  }
  switch (error.failure.reason) {
    case "MalformedPath":
      return 400;
    case "NotFound":
      return 404;
    case "InspectionFailed":
    case "NotDirectory":
    case "NotRepository":
      return 422;
  }
}

function respondToRepositoryCatalogRequest(
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
        readRequestCredential(request),
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
        readRequestCredential(request),
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
        readRequestCredential(request),
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
        readRequestCredential(request),
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
