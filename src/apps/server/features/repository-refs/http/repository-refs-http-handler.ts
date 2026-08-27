import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CheckoutRepositoryRef,
  ReadRepositoryRefs,
  RepositoryCheckedOut,
  RepositoryRefsHttpApi,
  RepositoryRefs as RepositoryRefsSchema,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  expectedRequestOrigin,
  readBearerCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";
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
      const query = yield* decodeValue(
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
      const command = yield* decodeValue(
        CheckoutRepositoryRef,
        yield* parseBody(body),
      );
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

function parseBody(body: Buffer) {
  return Effect.try({
    try: () => JSON.parse(body.toString("utf8")) as unknown,
    catch: invalidMessage,
  });
}

function decodeValue<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown,
) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(schema)(value, { onExcessProperty: "error" }),
    catch: invalidMessage,
  });
}

function invalidMessage() {
  return new EnvironmentHttpBodyError({
    failure: { _tag: "InvalidMessage" },
  });
}
