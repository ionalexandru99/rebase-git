import type { IncomingMessage, ServerResponse } from "node:http";
import { RepositoryChangesHttpApi } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect } from "effect";
import type { RepositoryChangesService } from "#server/domain/repository-changes.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  readRequestCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import {
  decodeRequestBody,
  requireMethod,
} from "#server/features/environment-connection/http/environment-http-request-validation";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function respondToRepositoryChangesRequest(
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
      action === "read" || action === "diff"
        ? "repository.read"
        : "repository.write",
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
