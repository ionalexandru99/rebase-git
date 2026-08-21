import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-connection.contract";
import { EnvironmentWebSocketSessionClosed } from "@rebase/server/features/environment-connection/websocket/environment-websocket-error.contract";
import { Cause, Effect, Queue } from "effect";
import type { RawData, WebSocket } from "ws";

export interface EnvironmentSocketMessage {
  readonly data: RawData;
  readonly isBinary: boolean;
}

export function acquireEnvironmentWebSocketInbox(
  socket: WebSocket,
  state: EnvironmentTransportState,
) {
  return Effect.gen(function* () {
    const messages = yield* Queue.bounded<
      EnvironmentSocketMessage,
      EnvironmentWebSocketSessionClosed
    >(state.discovery.limits.maxQueuedEvents);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const receive = (data: RawData, isBinary: boolean) => {
          if (!Queue.offerUnsafe(messages, { data, isBinary })) {
            socket.close(1013, "IncomingQueueOverflow");
            Queue.failCauseUnsafe(
              messages,
              Cause.fail(new EnvironmentWebSocketSessionClosed()),
            );
          }
        };
        const close = () => {
          Queue.failCauseUnsafe(
            messages,
            Cause.fail(new EnvironmentWebSocketSessionClosed()),
          );
        };

        socket.on("message", receive);
        socket.on("close", close);
        socket.on("error", close);
        return { close, receive };
      }),
      ({ close, receive }) =>
        Effect.sync(() => {
          socket.off("message", receive);
          socket.off("close", close);
          socket.off("error", close);
        }).pipe(Effect.andThen(Queue.shutdown(messages))),
    );
    return messages;
  });
}
