import type { IncomingMessage } from "node:http";
import {
  currentTransportLimits,
  type EnvironmentHttpFailure,
} from "@rebase/contracts";
import { Effect } from "effect";

const maximumRequestBytes = currentTransportLimits.maxHttpRequestBytes;

export function readEnvironmentHttpRequestBody(request: IncomingMessage) {
  return Effect.callback<void, HttpBodyFailure>((resume) => {
    const state: BodyReadState = {
      hasBody: declaredBodyLength(request) > 0,
      receivedBytes: 0,
    };
    const finish = finishBodyRead(resume);
    const rejectOversizedPayload = () => {
      rejectPayloadTooLarge(request, finish);
    };
    const receive = (chunk: Buffer) =>
      receiveBodyChunk(state, chunk, rejectOversizedPayload);
    const end = () => completeBodyRead(state, finish);
    const rejectInvalidMessage = () => {
      finish(Effect.fail(invalidMessageFailure()));
    };
    const handlers = { end, receive, rejectInvalidMessage };

    if (declaredBodyLength(request) > maximumRequestBytes) {
      rejectOversizedPayload();
      return;
    }

    attachBodyHandlers(request, handlers);
    return Effect.sync(() => detachBodyHandlers(request, handlers));
  });
}

function finishBodyRead(
  resume: (effect: Effect.Effect<void, HttpBodyFailure>) => void,
) {
  let settled = false;
  return (effect: Effect.Effect<void, HttpBodyFailure>) => {
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
  state.hasBody = true;
  state.receivedBytes += chunk.byteLength;
  if (state.receivedBytes > maximumRequestBytes) {
    rejectPayload();
  }
}

function completeBodyRead(state: BodyReadState, finish: FinishBodyRead) {
  finish(state.hasBody ? Effect.fail(invalidMessageFailure()) : Effect.void);
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

function invalidMessageFailure(): HttpBodyFailure {
  return {
    failure: { _tag: "InvalidMessage" },
    status: 400,
  };
}

function payloadTooLargeFailure(): HttpBodyFailure {
  return {
    failure: {
      _tag: "PayloadTooLarge",
      limitBytes: maximumRequestBytes,
    },
    status: 413,
  };
}

interface BodyReadState {
  hasBody: boolean;
  receivedBytes: number;
}

interface BodyHandlers {
  readonly end: () => void;
  readonly receive: (chunk: Buffer) => void;
  readonly rejectInvalidMessage: () => void;
}

type FinishBodyRead = (effect: Effect.Effect<void, HttpBodyFailure>) => void;

interface HttpBodyFailure {
  readonly failure: typeof EnvironmentHttpFailure.Type;
  readonly status: 400 | 413;
}
