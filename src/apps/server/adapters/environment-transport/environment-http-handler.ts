import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type EnvironmentAccessFailure,
  EnvironmentBrowserSession,
  EnvironmentPairingExchanged,
  ExchangeEnvironmentPairing,
  environmentBrowserSessionPath,
  environmentPairingExchangePath,
} from "@rebase/contracts";
import { Data, Effect, Schema } from "effect";
import { respondWithBrowserAsset } from "#server/adapters/browser-assets";
import {
  accessFailureStatus,
  validateRequestHost,
  validateRequestOrigin,
  writeBrowserSessionCookie,
} from "#server/adapters/environment-transport/environment-request-authorization";
import type {
  EnvironmentAuthorization,
  EnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization";
import type { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";

export type RunEnvironmentEffect = (
  effect: Effect.Effect<void, never, never>,
  signal?: AbortSignal,
) => void;

class EnvironmentRequestRejected extends Data.TaggedError(
  "EnvironmentRequestRejected",
)<{ readonly failure: EnvironmentAccessFailure }> {}

type EnvironmentHttpError =
  | EnvironmentAuthorizationError
  | EnvironmentRequestRejected
  | EnvironmentStorageError;

const maximumRequestBytes = 65_536;
const decodeExchange = Schema.decodeUnknownSync(ExchangeEnvironmentPairing);

export function createEnvironmentHttpHandler(
  authorization: EnvironmentAuthorization,
  ready: () => boolean,
  runEnvironmentEffect: RunEnvironmentEffect,
  browserAssetsRoot?: string,
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    response.once("close", abort);
    runEnvironmentEffect(
      respondToEnvironmentRequest(
        request,
        response,
        authorization,
        ready(),
        browserAssetsRoot,
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => writeEnvironmentHttpError(response, error)),
        ),
        Effect.ensuring(Effect.sync(() => response.off("close", abort))),
      ),
      abortController.signal,
    );
  };
}

function respondToEnvironmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authorization: EnvironmentAuthorization,
  ready: boolean,
  browserAssetsRoot?: string,
): Effect.Effect<void, EnvironmentHttpError> {
  return Effect.gen(function* () {
    if (request.url === "/health") {
      if (request.method !== "GET") return rejectMethod(response, "GET");
      writeJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "starting",
      });
      return;
    }
    yield* validateRequestHost(request);
    if (
      browserAssetsRoot !== undefined &&
      (yield* respondWithBrowserAsset(request, response, browserAssetsRoot))
    )
      return;
    const browserSession = request.url === environmentBrowserSessionPath;
    if (!browserSession && request.url !== environmentPairingExchangePath) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") return rejectMethod(response, "POST");
    yield* validateRequestOrigin(request, browserSession);
    const exchange = yield* readPairingExchange(request);
    const paired = yield* authorization.exchangePairing(exchange);
    if (!browserSession) {
      writeJson(
        response,
        200,
        Schema.encodeSync(EnvironmentPairingExchanged)(paired),
      );
      return;
    }
    writeBrowserSessionCookie(request, response, paired.credential);
    writeJson(
      response,
      200,
      Schema.encodeSync(EnvironmentBrowserSession)({
        authorization: paired.authorization,
      }),
    );
  });
}

function readPairingExchange(request: IncomingMessage) {
  return Effect.callback<Buffer, EnvironmentRequestRejected>((resume) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const finish = (
      result: Effect.Effect<Buffer, EnvironmentRequestRejected>,
    ) => {
      detach();
      resume(result);
    };
    const tooLarge = () => {
      finish(
        Effect.fail(
          rejected({
            _tag: "PayloadTooLarge",
            limitBytes: maximumRequestBytes,
          }),
        ),
      );
      request.resume();
    };
    const receive = (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximumRequestBytes) tooLarge();
      else chunks.push(chunk);
    };
    const end = () => finish(Effect.succeed(Buffer.concat(chunks)));
    const failed = () =>
      finish(Effect.fail(rejected({ _tag: "InvalidMessage" })));
    const detach = () => {
      request.off("data", receive);
      request.off("end", end);
      request.off("error", failed);
    };
    if (Number(request.headers["content-length"] ?? 0) > maximumRequestBytes) {
      tooLarge();
      return;
    }
    request.on("data", receive);
    request.on("end", end);
    request.on("error", failed);
    return Effect.sync(detach);
  }).pipe(
    Effect.flatMap((body) =>
      Effect.try({
        try: () =>
          decodeExchange(JSON.parse(body.toString("utf8")), {
            onExcessProperty: "error",
          }),
        catch: () => rejected({ _tag: "InvalidMessage" }),
      }),
    ),
  );
}

function rejectMethod(response: ServerResponse, method: string) {
  response.writeHead(405, { allow: method }).end();
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function writeEnvironmentHttpError(
  response: ServerResponse,
  error: EnvironmentHttpError,
) {
  if (response.writableEnded) return;
  if (error._tag === "EnvironmentStorageError") {
    response.writeHead(500).end();
    return;
  }
  writeJson(response, accessFailureStatus(error.failure), error.failure);
}

function rejected(failure: EnvironmentAccessFailure) {
  return new EnvironmentRequestRejected({ failure });
}
