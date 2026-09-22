import type { IncomingMessage, ServerResponse } from "node:http";
import { CommitInspectionHttpApi } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { ChangesFailure } from "@rebase/contracts/repository-changes/repository-changes.contract";
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
import type { CommitInspectionService } from "#server/domain/commit-inspection.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";

export function createCommitInspectionHttpHandler(
  authorization: EnvironmentAuthorization,
  inspection: CommitInspectionService,
): EnvironmentHttpRequestHandler {
  return (request, response, body) =>
    respondToCommitInspectionRequest(
      request,
      response,
      body,
      authorization,
      inspection,
    );
}

function respondToCommitInspectionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  inspection: CommitInspectionService,
) {
  const api = CommitInspectionHttpApi;
  return Effect.gen(function* () {
    if (
      request.url !== api.inspect.path &&
      request.url !== api.inspectDiff.path
    ) {
      return false;
    }
    yield* requireMethod(request, response, "POST");
    yield* validateRequestOrigin(request, false);
    yield* authorization.authorize(
      readRequestCredential(request),
      "repository.read",
    );
    if (request.url === api.inspect.path) {
      writeJson(
        response,
        200,
        api.inspect.success,
        yield* inspection.inspect(
          yield* decodeRequestBody(api.inspect.request, body),
        ),
      );
    } else {
      writeJson(
        response,
        200,
        api.inspectDiff.success,
        yield* inspection.inspectDiff(
          yield* decodeRequestBody(api.inspectDiff.request, body),
        ),
      );
    }
    return true;
  }).pipe(
    Effect.catchTag("CommitInspectionError", (error) =>
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
