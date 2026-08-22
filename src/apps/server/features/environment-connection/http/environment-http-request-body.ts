import type { IncomingMessage } from "node:http";
import { currentTransportLimits } from "@rebase/contracts";
import { Effect } from "effect";
import { EnvironmentHttpBodyError } from "#server/features/environment-connection/http/environment-http-request-body.contract";

const maximumRequestBytes = currentTransportLimits.maxHttpRequestBytes;

export function readEnvironmentHttpRequestBody(request: IncomingMessage) {
  return Effect.callback<Buffer, EnvironmentHttpBodyError>((resume) => {
    const state: BodyReadState = {
      chunks: [],
      receivedBytes: 0,
    };
    const finish = finishBodyRead(resume);
    const handlers = createBodyHandlers(request, state, finish);

    if (declaredBodyLength(request) > maximumRequestBytes) {
      rejectPayloadTooLarge(request, finish);
      return;
    }

    attachBodyHandlers(request, handlers);
    return Effect.sync(() => detachBodyHandlers(request, handlers));
  });
}

function createBodyHandlers(
  request: IncomingMessage,
  state: BodyReadState,
  finish: FinishBodyRead,
): BodyHandlers {
  return {
    end: () => completeBodyRead(state, finish),
    receive: (chunk) =>
      receiveBodyChunk(state, chunk, () =>
        rejectPayloadTooLarge(request, finish),
      ),
    rejectInvalidMessage: () => {
      finish(Effect.fail(invalidMessageFailure()));
    },
  };
}

function finishBodyRead(
  resume: (effect: Effect.Effect<Buffer, EnvironmentHttpBodyError>) => void,
) {
  let settled = false;
  return (effect: Effect.Effect<Buffer, EnvironmentHttpBodyError>) => {
    if (settled) {
      return;
    }
    settled = true;
    resume(effect);
  };
}

function rejectPayloadTooLarge(
  request: IncomingMessage,
  finish: FinishBodyRead,
) {
  finish(Effect.fail(payloadTooLargeFailure()));
  request.resume();
}

function receiveBodyChunk(
  state: BodyReadState,
  chunk: Buffer,
  rejectPayload: () => void,
) {
  state.receivedBytes += chunk.byteLength;
  if (state.receivedBytes > maximumRequestBytes) {
    rejectPayload();
    return;
  }
  state.chunks.push(chunk);
}

function completeBodyRead(state: BodyReadState, finish: FinishBodyRead) {
  finish(Effect.succeed(Buffer.concat(state.chunks, state.receivedBytes)));
}

function attachBodyHandlers(request: IncomingMessage, handlers: BodyHandlers) {
  request.on("data", handlers.receive);
  request.on("end", handlers.end);
  request.on("aborted", handlers.rejectInvalidMessage);
  request.on("error", handlers.rejectInvalidMessage);
}

function detachBodyHandlers(request: IncomingMessage, handlers: BodyHandlers) {
  request.off("data", handlers.receive);
  request.off("end", handlers.end);
  request.off("aborted", handlers.rejectInvalidMessage);
  request.off("error", handlers.rejectInvalidMessage);
}

function declaredBodyLength(request: IncomingMessage) {
  return Number(request.headers["content-length"] ?? 0);
}

function invalidMessageFailure() {
  return new EnvironmentHttpBodyError({
    failure: { _tag: "InvalidMessage" },
  });
}

function payloadTooLargeFailure() {
  return new EnvironmentHttpBodyError({
    failure: {
      _tag: "PayloadTooLarge",
      limitBytes: maximumRequestBytes,
    },
  });
}

interface BodyReadState {
  readonly chunks: Buffer[];
  receivedBytes: number;
}

interface BodyHandlers {
  readonly end: () => void;
  readonly receive: (chunk: Buffer) => void;
  readonly rejectInvalidMessage: () => void;
}

type FinishBodyRead = (
  effect: Effect.Effect<Buffer, EnvironmentHttpBodyError>,
) => void;
