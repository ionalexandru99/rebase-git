import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EnvironmentDirectory,
  EnvironmentFilesystemHttpApi,
  ListEnvironmentDirectory,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import type { EnvironmentFilesystem } from "#server/domain/environment-filesystem.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  readBearerCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function respondToEnvironmentFilesystemRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
  filesystem: EnvironmentFilesystem,
) {
  if (request.url !== EnvironmentFilesystemHttpApi.listDirectory.path) {
    return Effect.succeed(false);
  }

  return Effect.gen(function* () {
    yield* requireMethod(
      request,
      response,
      EnvironmentFilesystemHttpApi.listDirectory.method,
    );
    yield* validateRequestOrigin(request, false);
    yield* authorization.authorize(
      readBearerCredential(request),
      "repository.write",
    );
    const requestedDirectory = yield* decodeRequestBody(body);
    const listing = yield* filesystem.listDirectory(
      requestedDirectory.path,
      requestedDirectory.includeHidden,
    );
    writeJson(
      response,
      EnvironmentFilesystemHttpApi.listDirectory.successStatus,
      EnvironmentDirectory,
      listing,
    );
    return true;
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

function decodeRequestBody(body: Buffer) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(ListEnvironmentDirectory)(
        JSON.parse(body.toString("utf8")),
        {
          onExcessProperty: "error",
        },
      ),
    catch: () =>
      new EnvironmentHttpBodyError({
        failure: { _tag: "InvalidMessage" },
      }),
  });
}
