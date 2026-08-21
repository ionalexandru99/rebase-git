import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EnvironmentDiscovery,
  EnvironmentHttpApi,
  EnvironmentHttpFailure,
  EnvironmentSnapshot,
} from "@rebase/contracts";
import type {
  EnvironmentTransportState,
  RunEnvironmentEffect,
} from "@rebase/server/features/environment-connection/environment-connection.contract";
import { readEnvironmentHttpRequestBody } from "@rebase/server/features/environment-connection/http/environment-http-request-body";
import { Effect, Schema } from "effect";

export function createEnvironmentHttpHandler(
  state: EnvironmentTransportState,
  ready: () => boolean,
  runEnvironmentEffect: RunEnvironmentEffect,
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const lifetime = startHttpRequestLifetime(request, response);
    runEnvironmentEffect(
      createEnvironmentHttpResponse(request, response, state, ready()).pipe(
        Effect.ensuring(Effect.sync(lifetime.release)),
      ),
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
  ready: boolean,
) {
  return respondToEnvironmentRequest(request, response, state, ready).pipe(
    Effect.catch((bodyFailure) =>
      Effect.sync(() =>
        writeJson(
          response,
          bodyFailure.status,
          EnvironmentHttpFailure,
          bodyFailure.failure,
        ),
      ),
    ),
  );
}

function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: EnvironmentTransportState,
  ready: boolean,
) {
  return Effect.gen(function* () {
    yield* readEnvironmentHttpRequestBody(request);

    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end();
      return;
    }

    if (request.url === "/health") {
      writeJsonValue(response, ready ? 200 : 503, {
        status: ready ? "ready" : "starting",
      });
      return;
    }

    if (request.url === EnvironmentHttpApi.discovery.path) {
      writeJson(
        response,
        EnvironmentHttpApi.discovery.successStatus,
        EnvironmentDiscovery,
        state.discovery,
      );
      return;
    }

    if (request.url === EnvironmentHttpApi.snapshot.path) {
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

    response.writeHead(404).end();
  });
}

function writeJson<S extends Schema.ConstraintEncoder<unknown, never>>(
  response: ServerResponse,
  status: number,
  schema: S,
  value: S["Type"],
) {
  writeJsonValue(response, status, Schema.encodeSync(schema)(value));
}

function writeJsonValue(
  response: ServerResponse,
  status: number,
  value: unknown,
) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

interface HttpRequestLifetime {
  readonly release: () => void;
  readonly signal: AbortSignal;
}
