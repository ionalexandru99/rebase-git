import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { respondWithBrowserAsset } from "#server/adapters/browser-client/browser-assets";
import type { RunEnvironmentEffect } from "#server/adapters/environment-transport/environment-connection.contract";
import { validateRequestHost } from "#server/adapters/environment-transport/environment-request-authorization";
import { readEnvironmentHttpRequestBody } from "#server/adapters/environment-transport/http/environment-http-request-body";
import {
  requireEmptyBody,
  requireMethod,
} from "#server/adapters/environment-transport/http/environment-http-request-validation";
import {
  writeEnvironmentHttpError,
  writeJsonValue,
} from "#server/adapters/environment-transport/http/environment-http-response";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import { routeEnvironmentHttpRequest } from "#server/adapters/environment-transport/http/environment-http-router";
import type { EnvironmentAuthorization } from "#server/domain/environment-authorization.contract";

export function createEnvironmentHttpHandler(
  authorization: EnvironmentAuthorization,
  routes: readonly EnvironmentHttpRouteHandler[],
  ready: () => boolean,
  runEnvironmentEffect: RunEnvironmentEffect,
  browserAssetsRoot?: string,
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const lifetime = startHttpRequestLifetime(request, response);
    runEnvironmentEffect(
      respondToEnvironmentRequest(
        request,
        response,
        authorization,
        routes,
        ready(),
        browserAssetsRoot,
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => writeEnvironmentHttpError(response, error)),
        ),
        Effect.ensuring(Effect.sync(lifetime.release)),
      ),
      lifetime.signal,
    );
  };
}

function startHttpRequestLifetime(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  request.once("aborted", abort);
  response.once("close", abort);
  return {
    release: () => {
      request.off("aborted", abort);
      response.off("close", abort);
    },
    signal: abortController.signal,
  };
}

function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authorization: EnvironmentAuthorization,
  routes: readonly EnvironmentHttpRouteHandler[],
  ready: boolean,
  browserAssetsRoot?: string,
) {
  return Effect.gen(function* () {
    if (request.url === "/health") {
      yield* requireMethod(request, response, "GET");
      yield* requireEmptyBody(yield* readEnvironmentHttpRequestBody(request));
      writeJsonValue(response, ready ? 200 : 503, {
        status: ready ? "ready" : "starting",
      });
      return;
    }
    yield* validateRequestHost(request);
    if (
      browserAssetsRoot !== undefined &&
      (yield* respondWithBrowserAsset(request, response, browserAssetsRoot))
    ) {
      return;
    }
    const body = yield* readEnvironmentHttpRequestBody(request);
    yield* routeEnvironmentHttpRequest(
      routes,
      authorization,
      request,
      response,
      body,
    );
  });
}
