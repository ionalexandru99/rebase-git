import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import {
  expectedRequestOrigin,
  readRequestCredential,
  validateRequestOrigin,
} from "#server/adapters/environment-transport/environment-request-authorization";
import {
  decodeRequestBody,
  requireEmptyBody,
} from "#server/adapters/environment-transport/http/environment-http-request-validation";
import {
  writeEnvironmentHttpError,
  writeJson,
} from "#server/adapters/environment-transport/http/environment-http-response";
import type {
  EnvironmentHttpRequestContext,
  EnvironmentHttpRouteFailure,
  EnvironmentHttpRouteHandler,
} from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { writeBrowserSessionCookie } from "#server/features/environment-authorization/http/environment-session-cookie";

export function routeEnvironmentHttpRequest(
  handlers: readonly EnvironmentHttpRouteHandler[],
  authorization: EnvironmentAuthorization,
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
): Effect.Effect<void> {
  const candidates = handlers.filter(
    (handler) => handler.route.path === request.url,
  );
  const handler = candidates.find(
    (candidate) => candidate.route.method === request.method,
  );
  if (handler === undefined) {
    return Effect.sync(() => rejectUnroutedRequest(response, candidates));
  }
  return serveRoute(handler, authorization, request, response, body);
}

function serveRoute(
  handler: EnvironmentHttpRouteHandler,
  authorization: EnvironmentAuthorization,
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
) {
  const { route } = handler;
  return Effect.gen(function* () {
    yield* validateRequestOrigin(request, handler.requiresOrigin);
    if (route.request === undefined) {
      yield* requireEmptyBody(body);
    }
    const credential = readRequestCredential(request);
    const device =
      route.capability === null
        ? undefined
        : yield* authorization.authorize(credential, route.capability);
    const command =
      route.request === undefined
        ? undefined
        : yield* decodeRequestBody(route.request, body);
    yield* runRouteHandler(handler, command, response, {
      credential,
      device,
      establishBrowserSession: (sessionCredential) =>
        writeBrowserSessionCookie(request, response, sessionCredential),
      origin: expectedRequestOrigin(request),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => writeEnvironmentHttpError(response, error)),
    ),
  );
}

function runRouteHandler(
  handler: EnvironmentHttpRouteHandler,
  command: unknown,
  response: ServerResponse,
  context: EnvironmentHttpRequestContext,
) {
  const { route } = handler;
  return handler.handle(command, context).pipe(
    Effect.map((value) =>
      writeJson(response, route.successStatus, route.success, value),
    ),
    Effect.catchTags({
      EnvironmentAuthorizationError: (error) =>
        Effect.sync(() => writeEnvironmentHttpError(response, error)),
      EnvironmentStorageError: (error) =>
        Effect.sync(() => writeEnvironmentHttpError(response, error)),
    }),
    Effect.catch((failure) =>
      Effect.sync(() => writeRouteFailure(response, handler, failure)),
    ),
  );
}

function writeRouteFailure(
  response: ServerResponse,
  handler: EnvironmentHttpRouteHandler,
  failure: EnvironmentHttpRouteFailure,
) {
  const status = handler.failureStatus?.(failure);
  if (status === undefined) {
    response.writeHead(500).end();
    return;
  }
  writeJson(response, status, handler.route.failure, failure.failure);
}

function rejectUnroutedRequest(
  response: ServerResponse,
  candidates: readonly EnvironmentHttpRouteHandler[],
) {
  if (candidates.length === 0) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(405, { allow: allowedMethods(candidates) }).end();
}

function allowedMethods(candidates: readonly EnvironmentHttpRouteHandler[]) {
  return [...new Set(candidates.map((candidate) => candidate.route.method))]
    .sort()
    .join(", ");
}
