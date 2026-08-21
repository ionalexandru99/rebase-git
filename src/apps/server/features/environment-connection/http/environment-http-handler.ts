import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EnvironmentAuthorizationFailure,
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  EnvironmentHttpFailure,
  EnvironmentSnapshot,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import type {
  EnvironmentAuthorization,
  EnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization.contract";
import { respondToEnvironmentAuthorizationRequest } from "#server/features/environment-authorization/http/environment-authorization-http-handler";
import type {
  EnvironmentTransportState,
  RunEnvironmentEffect,
} from "#server/features/environment-connection/environment-connection.contract";
import {
  authorizationFailureStatus,
  readBearerCredential,
  validateRequestHost,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import {
  EnvironmentHttpBodyError,
  readEnvironmentHttpRequestBody,
} from "#server/features/environment-connection/http/environment-http-request-body";
import {
  writeJson,
  writeJsonValue,
} from "#server/features/environment-connection/http/environment-http-response";
import type { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";

export function createEnvironmentHttpHandler(
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  ready: () => boolean,
  runEnvironmentEffect: RunEnvironmentEffect,
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const lifetime = startHttpRequestLifetime(request, response);
    runEnvironmentEffect(
      createEnvironmentHttpResponse(
        request,
        response,
        state,
        authorization,
        ready(),
      ).pipe(Effect.ensuring(Effect.sync(lifetime.release))),
      lifetime.signal,
    );
  };
}

function startHttpRequestLifetime(
  request: IncomingMessage,
  response: ServerResponse,
): HttpRequestLifetime {
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

function createEnvironmentHttpResponse(
  request: IncomingMessage,
  response: ServerResponse,
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  ready: boolean,
) {
  return respondToEnvironmentRequest(
    request,
    response,
    state,
    authorization,
    ready,
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => writeEnvironmentHttpError(response, error)),
    ),
  );
}

function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  ready: boolean,
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
    const body = yield* readEnvironmentHttpRequestBody(request);

    if (request.url === EnvironmentHttpApi.discovery.path) {
      yield* requireMethod(
        request,
        response,
        EnvironmentHttpApi.discovery.method,
      );
      yield* requireEmptyBody(body);
      writeJson(
        response,
        EnvironmentHttpApi.discovery.successStatus,
        EnvironmentDiscovery,
        state.discovery,
      );
      return;
    }

    if (request.url === EnvironmentHttpApi.snapshot.path) {
      yield* requireMethod(
        request,
        response,
        EnvironmentHttpApi.snapshot.method,
      );
      yield* requireEmptyBody(body);
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readBearerCredential(request),
        "environment.read",
      );
      writeJson(
        response,
        EnvironmentHttpApi.snapshot.successStatus,
        EnvironmentSnapshot,
        {
          environmentId: state.discovery.environmentId,
          sequence: state.events.currentSequence(),
        },
      );
      return;
    }

    if (
      yield* respondToEnvironmentAuthorizationRequest(
        request,
        response,
        body,
        authorization,
      )
    ) {
      return;
    }

    response.writeHead(404).end();
  });
}

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
) {
  if (request.method === method) {
    return Effect.void;
  }
  return Effect.sync(() =>
    response.writeHead(405, { allow: method }).end(),
  ).pipe(Effect.andThen(Effect.interrupt));
}

function requireEmptyBody(body: Buffer) {
  return body.byteLength === 0
    ? Effect.void
    : Effect.fail(new EnvironmentHttpBodyError({ _tag: "InvalidMessage" }));
}

function writeEnvironmentHttpError(
  response: ServerResponse,
  error:
    | EnvironmentAuthorizationError
    | EnvironmentHttpBodyError
    | EnvironmentStorageError,
) {
  if (response.writableEnded) {
    return;
  }
  if (error._tag === "EnvironmentAuthorizationError") {
    writeJson(
      response,
      authorizationFailureStatus(error.failure),
      EnvironmentAuthorizationFailure,
      error.failure,
    );
    return;
  }
  if (error._tag === "EnvironmentHttpBodyError") {
    writeJson(
      response,
      error.failure._tag === "PayloadTooLarge" ? 413 : 400,
      EnvironmentHttpFailure,
      error.failure,
    );
    return;
  }
  response.writeHead(500).end();
}

interface HttpRequestLifetime {
  readonly release: () => void;
  readonly signal: AbortSignal;
}
