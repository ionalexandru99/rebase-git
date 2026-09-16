import type { IncomingMessage, ServerResponse } from "node:http";
import { RepositoryOperationsHttpApi } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect } from "effect";
import type { RepositoryOperationsService } from "#server/domain/repository-operations.contract";
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

export function respondToRepositoryOperationsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  operations: RepositoryOperationsService,
) {
  return Effect.gen(function* () {
    const api = RepositoryOperationsHttpApi;
    const read = request.url === api.read.path;
    if (!read && request.url !== api.execute.path) return false;
    yield* requireMethod(request, response, "POST");
    yield* validateRequestOrigin(request, false);
    yield* authorization.authorize(
      readRequestCredential(request),
      read ? "repository.read" : "repository.write",
    );
    if (read)
      writeJson(
        response,
        200,
        api.read.success,
        yield* operations.read(
          yield* decodeRequestBody(api.read.request, body),
        ),
      );
    else
      writeJson(
        response,
        200,
        api.execute.success,
        yield* operations.execute(
          yield* decodeRequestBody(api.execute.request, body),
        ),
      );
    return true;
  });
}
