import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryRefsHttpApi,
  RepositoryRefsOperationFailure,
} from "@rebase/contracts";
import { Effect } from "effect";
import type {
  RepositoryRefsError,
  RepositoryRefsService,
} from "#server/domain/repository-refs.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  expectedRequestOrigin,
  readRequestCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import type { EnvironmentHttpRequestHandler } from "#server/features/environment-connection/http/environment-http-handler.contract";
import {
  decodeRequestBody,
  requireMethod,
} from "#server/features/environment-connection/http/environment-http-request-validation";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function createRepositoryRefsHttpHandler(
  authorization: EnvironmentAuthorization,
  refs: RepositoryRefsService,
): EnvironmentHttpRequestHandler {
  return (request, response, body) =>
    respondToRepositoryRefsRequest(
      request,
      response,
      body,
      authorization,
      refs,
    ).pipe(
      Effect.catchTag("RepositoryRefsError", (error) =>
        Effect.sync(() => {
          writeJson(
            response,
            failureStatus(error),
            RepositoryRefsOperationFailure,
            error.failure,
          );
          return true;
        }),
      ),
    );
}

function failureStatus(error: RepositoryRefsError) {
  switch (error.failure._tag) {
    case "RepositoryMissing":
    case "WorktreeMissing":
    case "RefMissing":
      return 404;
    case "BranchCheckedOutElsewhere":
    case "CheckoutRejected":
      return 409;
    case "GitFailed":
      return 422;
  }
}

function respondToRepositoryRefsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  refs: RepositoryRefsService,
) {
  const url = requestUrl(request);
  return Effect.gen(function* () {
    if (url?.pathname === RepositoryRefsHttpApi.checkout.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryRefsHttpApi.checkout.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readRequestCredential(request),
        "repository.write",
      );
      const command = yield* decodeRequestBody(CheckoutRepositoryRef, body);
      writeJson(
        response,
        RepositoryRefsHttpApi.checkout.successStatus,
        RepositoryCheckedOut,
        yield* refs.checkout(command),
      );
      return true;
    }

    return false;
  });
}

function requestUrl(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "", expectedRequestOrigin(request));
  } catch {
    return undefined;
  }
}
