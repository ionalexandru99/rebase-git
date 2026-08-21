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
    const handlers = createInboxHandlers(socket, messages);
    yield* Effect.acquireRelease(
      Effect.sync(() => attachInboxHandlers(socket, handlers)),
      () =>
        Effect.sync(() => detachInboxHandlers(socket, handlers)).pipe(
          Effect.andThen(Queue.shutdown(messages)),
        ),
    );
    return messages;
  });
}

function createInboxHandlers(
  socket: WebSocket,
  messages: Queue.Queue<
    EnvironmentSocketMessage,
    EnvironmentWebSocketSessionClosed
  >,
): InboxHandlers {
  const close = () => {
    Queue.failCauseUnsafe(
      messages,
      Cause.fail(new EnvironmentWebSocketSessionClosed()),
    );
  };

  return {
    close,
    receive: (data, isBinary) => {
      if (!Queue.offerUnsafe(messages, { data, isBinary })) {
        socket.close(1013, "IncomingQueueOverflow");
        close();
      }
    },
  };
}

function attachInboxHandlers(socket: WebSocket, handlers: InboxHandlers) {
  socket.on("message", handlers.receive);
  socket.on("close", handlers.close);
  socket.on("error", handlers.close);
}

function detachInboxHandlers(socket: WebSocket, handlers: InboxHandlers) {
  socket.off("message", handlers.receive);
  socket.off("close", handlers.close);
  socket.off("error", handlers.close);
}

interface InboxHandlers {
  readonly close: () => void;
  readonly receive: (data: RawData, isBinary: boolean) => void;
}
