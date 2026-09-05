import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CheckoutRepositoryRef,
  ReadRepositoryRefs,
  RepositoryCheckedOut,
  RepositoryRefsHttpApi,
  RepositoryRefs as RepositoryRefsSchema,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  expectedRequestOrigin,
  readBearerCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import {
  decodeRequestBody,
  decodeRequestValue,
  requireEmptyBody,
  requireMethod,
} from "#server/features/environment-connection/http/environment-http-request-validation";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function respondToRepositoryRefsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  refs: RepositoryRefsService,
) {
  const url = requestUrl(request);
  return Effect.gen(function* () {
    if (url?.pathname === RepositoryRefsHttpApi.read.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryRefsHttpApi.read.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* requireEmptyBody(body);
      yield* authorization.authorize(
        readBearerCredential(request),
        "repository.read",
      );
      const query = yield* decodeRequestValue(
        ReadRepositoryRefs,
        Object.fromEntries(url.searchParams),
      );
      writeJson(
        response,
        RepositoryRefsHttpApi.read.successStatus,
        RepositoryRefsSchema,
        yield* refs.read(query.repositoryId),
      );
      return true;
    }

    if (url?.pathname === RepositoryRefsHttpApi.checkout.path) {
      yield* requireMethod(
        request,
        response,
        RepositoryRefsHttpApi.checkout.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readBearerCredential(request),
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
