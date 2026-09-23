import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ChangesFailure,
  RepositoryChangesHttpApi,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect } from "effect";
import {
  readRequestCredential,
  validateRequestOrigin,
} from "#server/adapters/environment-transport/environment-request-authorization";
import type { EnvironmentHttpRequestHandler } from "#server/adapters/environment-transport/http/environment-http-handler.contract";
import {
  decodeRequestBody,
  requireMethod,
} from "#server/adapters/environment-transport/http/environment-http-request-validation";
import { writeJson } from "#server/adapters/environment-transport/http/environment-http-response";
import type { RepositoryChangesService } from "#server/domain/repository-changes.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";

export function createRepositoryChangesHttpHandler(
  authorization: EnvironmentAuthorization,
  changes: RepositoryChangesService,
): EnvironmentHttpRequestHandler {
  return (request, response, body) =>
    respondToRepositoryChangesRequest(
      request,
      response,
      body,
      authorization,
      changes,
    ).pipe(
      Effect.catchTag("RepositoryChangesError", (error) =>
        Effect.sync(() => {
          writeJson(
            response,
            error.failure.reason === "Missing" ? 404 : 409,
            ChangesFailure,
            error.failure,
          );
          return true;
        }),
      ),
    );
}

function respondToRepositoryChangesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  changes: RepositoryChangesService,
) {
  return Effect.gen(function* () {
    const api = RepositoryChangesHttpApi;
    const action = (Object.keys(api) as (keyof typeof api)[]).find(
      (key) => api[key].path === request.url,
    );
    if (action === undefined) return false;
    yield* requireMethod(request, response, "POST");
    yield* validateRequestOrigin(request, false);
    yield* authorization.authorize(
      readRequestCredential(request),
      action === "mutate" || action === "commit"
        ? "repository.write"
        : "repository.read",
    );
    switch (action) {
      case "read":
        writeJson(
          response,
          200,
          api.read.success,
          yield* changes.read(yield* decodeRequestBody(api.read.request, body)),
        );
        break;
      case "diff":
        writeJson(
          response,
          200,
          api.diff.success,
          yield* changes.diff(yield* decodeRequestBody(api.diff.request, body)),
        );
        break;
      case "mutate":
        writeJson(
          response,
          200,
          api.mutate.success,
          yield* changes.mutate(
            yield* decodeRequestBody(api.mutate.request, body),
          ),
        );
        break;
      case "commit":
        writeJson(
          response,
          200,
          api.commit.success,
          yield* changes.commit(
            yield* decodeRequestBody(api.commit.request, body),
          ),
        );
        break;
    }
    return true;
  });
}
