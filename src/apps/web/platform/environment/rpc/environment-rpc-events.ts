import {
  environmentResponseError,
  fetchEnvironmentSnapshotWithinLimitEffect,
} from "@rebase/environment-client";
import { Effect, Ref, Stream } from "effect";
import type { EnvironmentRpcEvents } from "#web/platform/environment/rpc/environment-rpc-events.contract";
import { updateEnvironmentSequence } from "#web/platform/environment/websocket/environment-connection-state";
import { advanceEnvironmentSequence } from "#web/platform/environment/websocket/environment-sequence";

export function processEnvironmentRpcEvents(session: EnvironmentRpcEvents) {
  if (
    !session.negotiated.capabilities.some(
      ({ name }) => name === "environment-events",
    )
  )
    return Effect.never;
  return session.client
    .WatchEnvironment(undefined, { streamBufferSize: 1 })
    .pipe(
      Stream.mapError(() => environmentResponseError("WebSocket")),
      Stream.runForEach((message) =>
        Effect.gen(function* () {
          const advanced = advanceEnvironmentSequence(
            Ref.getUnsafe(session.state).currentSequence,
            message.sequence,
          );
          if (advanced._tag !== "SequenceIgnored")
            yield* advanced._tag === "SequenceAccepted"
              ? updateEnvironmentSequence(
                  session.state,
                  message.sequence,
                  message.repositoryIds,
                )
              : recoverEnvironmentSnapshot(session, message.sequence);
        }),
      ),
      Effect.andThen(Effect.fail(environmentResponseError("WebSocket"))),
    );
}

export function initializeEnvironmentRpcEvents(session: EnvironmentRpcEvents) {
  const previous = session.hello.lastObservedSequence;
  return previous !== undefined &&
    previous !== session.negotiated.currentSequence &&
    session.negotiated.capabilities.some(
      ({ name }) => name === "sequence-resnapshot",
    )
    ? recoverEnvironmentSnapshot(session, session.negotiated.currentSequence)
    : Effect.void;
}

function recoverEnvironmentSnapshot(
  session: EnvironmentRpcEvents,
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
    if (snapshot.sequence < minimumSequence)
      return yield* environmentResponseError("Snapshot");
    yield* updateEnvironmentSequence(session.state, snapshot.sequence);
  });
}
