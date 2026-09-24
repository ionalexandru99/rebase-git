import {
  type EnvironmentDiscovery,
  type EnvironmentHello,
  EnvironmentHttpApi,
  type EnvironmentRpcClient,
} from "@rebase/contracts";
import {
  type EnvironmentCredential,
  environmentResponseError,
  fetchEnvironmentSnapshotEffect,
} from "@rebase/environment-client";
import { Effect, Ref, Stream } from "effect";
import { hasEnvironmentCapability } from "#web/platform/environment/environment-capabilities";
import type { NegotiatedEnvironment } from "#web/platform/environment/environment-protocol.contract";
import {
  type EnvironmentConnectionState,
  updateEnvironmentSequence,
} from "#web/platform/environment/websocket/environment-connection-state";
import { advanceEnvironmentSequence } from "#web/platform/environment/websocket/environment-sequence";

export interface EnvironmentRpcEvents {
  readonly client: EnvironmentRpcClient;
  readonly credential: EnvironmentCredential;
  readonly discovery: EnvironmentDiscovery;
  readonly hello: EnvironmentHello;
  readonly negotiated: NegotiatedEnvironment;
  readonly origin: string;
  readonly signal: AbortSignal;
  readonly state: Ref.Ref<EnvironmentConnectionState>;
}

export function processEnvironmentRpcEvents(session: EnvironmentRpcEvents) {
  if (!hasEnvironmentCapability(session.negotiated, "environment-events"))
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
                  message.kind,
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
    hasEnvironmentCapability(session.negotiated, "sequence-resnapshot")
    ? recoverEnvironmentSnapshot(session, session.negotiated.currentSequence)
    : Effect.void;
}

function recoverEnvironmentSnapshot(
  session: EnvironmentRpcEvents,
  minimumSequence: number,
) {
  return Effect.gen(function* () {
    const snapshot = yield* fetchEnvironmentSnapshotEffect(
      session.origin,
      session.discovery,
      session.credential,
      {
        maxResponseBytes: Math.min(
          session.negotiated.limits.maxHttpResponseBytes,
          session.hello.receiveLimits.maxHttpResponseBytes,
        ),
        signal: session.signal,
      },
    );
    if (snapshot.sequence < minimumSequence)
      return yield* environmentResponseError(EnvironmentHttpApi.snapshot.path);
    yield* updateEnvironmentSequence(session.state, snapshot.sequence);
  });
}
