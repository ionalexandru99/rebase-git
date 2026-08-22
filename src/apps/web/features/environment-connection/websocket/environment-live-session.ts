import {
  type EnvironmentServerMessage,
  SnapshotApplied,
} from "@rebase/contracts";
import { Effect, Queue, Ref } from "effect";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import type { NegotiatedEnvironment } from "#web/features/environment-connection/environment-protocol-connection.contract";
import { fetchEnvironmentSnapshotWithinLimitEffect } from "#web/features/environment-connection/http/environment-http-client";
import { updateEnvironmentSequence } from "#web/features/environment-connection/websocket/environment-connection-state";
import type { EnvironmentLiveSession } from "#web/features/environment-connection/websocket/environment-live-session.contract";
import { advanceEnvironmentSequence } from "#web/features/environment-connection/websocket/environment-sequence";
import {
  decodeEnvironmentServerMessage,
  sendEnvironmentSocketMessage,
} from "#web/features/environment-connection/websocket/environment-socket";

type EnvironmentCapabilityName =
  NegotiatedEnvironment["capabilities"][number]["name"];

export function processEnvironmentServerMessages(
  session: EnvironmentLiveSession,
) {
  const capabilities = new Set(
    session.negotiated.capabilities.map((capability) => capability.name),
  );
  return Effect.gen(function* () {
    while (true) {
      const message = yield* readEnvironmentServerMessage(session);
      yield* handleEnvironmentServerMessage(session, capabilities, message);
    }
  });
}

function readEnvironmentServerMessage(session: EnvironmentLiveSession) {
  return Effect.gen(function* () {
    const event = yield* Queue.take(session.events);
    if (event._tag !== "Message") {
      return yield* Effect.fail(environmentResponseError("WebSocket"));
    }
    return yield* decodeEnvironmentServerMessage(
      event.event,
      session.hello,
      session.negotiated,
    );
  });
}

function handleEnvironmentServerMessage(
  session: EnvironmentLiveSession,
  capabilities: ReadonlySet<EnvironmentCapabilityName>,
  message: EnvironmentServerMessage,
) {
  switch (message._tag) {
    case "EnvironmentChanged":
      return handleEnvironmentChanged(session, capabilities, message.sequence);
    case "ResnapshotRequired":
      return capabilities.has("sequence-resnapshot")
        ? recoverEnvironmentSnapshot(session, message.currentSequence)
        : Effect.fail(environmentResponseError("WebSocket"));
    default:
      return Effect.fail(environmentResponseError("WebSocket"));
  }
}

function handleEnvironmentChanged(
  session: EnvironmentLiveSession,
  capabilities: ReadonlySet<EnvironmentCapabilityName>,
  sequence: number,
) {
  if (!capabilities.has("environment-events")) {
    return Effect.fail(environmentResponseError("WebSocket"));
  }

  const advanced = advanceEnvironmentSequence(
    Ref.getUnsafe(session.state).currentSequence,
    sequence,
  );
  return advanced._tag === "SequenceAccepted"
    ? updateEnvironmentSequence(session.state, advanced.sequence)
    : recoverEnvironmentSnapshot(session, sequence);
}

function recoverEnvironmentSnapshot(
  session: EnvironmentLiveSession,
  minimumSequence: number,
) {
  return Effect.gen(function* () {
    const snapshot = yield* fetchEnvironmentSnapshotWithinLimitEffect(
      session.origin,
      session.discovery,
      session.credential,
      Math.min(
        session.negotiated.limits.maxHttpResponseBytes,
        session.hello.receiveLimits.maxHttpResponseBytes,
      ),
      session.signal,
    );
    if (snapshot.sequence < minimumSequence) {
      return yield* Effect.fail(environmentResponseError("Snapshot"));
    }

    yield* updateEnvironmentSequence(session.state, snapshot.sequence);
    yield* sendEnvironmentSocketMessage(session.socket, SnapshotApplied, {
      _tag: "SnapshotApplied",
      sequence: snapshot.sequence,
    });
  });
}
