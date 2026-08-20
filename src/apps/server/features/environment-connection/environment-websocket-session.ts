import {
  EnvironmentClientMessage,
  EnvironmentHelloResult,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-transport.contract";
import { createEnvironmentWebSocketWriter } from "@rebase/server/features/environment-connection/environment-websocket-writer";
import { Schema } from "effect";
import type { RawData, WebSocket } from "ws";

export function startEnvironmentWebSocketSession(
  socket: WebSocket,
  state: EnvironmentTransportState,
) {
  const writer = createEnvironmentWebSocketWriter(socket, state);
  let helloCompleted = false;
  let resnapshotNegotiated = false;
  let unsubscribe: () => void = () => undefined;
  const helloTimeout = setTimeout(() => {
    rejectAndClose(socket, {
      _tag: "HelloRejected",
      failure: { _tag: "HandshakeRequired" },
    });
  }, state.discovery.limits.helloTimeoutMilliseconds);

  socket.on("error", () => undefined);
  socket.on("close", () => {
    clearTimeout(helloTimeout);
    unsubscribe();
  });
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      rejectAndClose(socket, {
        _tag: "HelloRejected",
        failure: { _tag: "InvalidMessage" },
      });
      return;
    }

    const message = decodeMessage(data);
    if (message === undefined) {
      rejectAndClose(socket, {
        _tag: "HelloRejected",
        failure: { _tag: "InvalidMessage" },
      });
      return;
    }

    if (!helloCompleted) {
      if (message._tag !== "Hello") {
        rejectAndClose(socket, {
          _tag: "HelloRejected",
          failure: { _tag: "HandshakeRequired" },
        });
        return;
      }

      clearTimeout(helloTimeout);
      const result = negotiateEnvironmentHello(
        state.discovery,
        message,
        state.events.currentSequence(),
      );
      if (result._tag === "HelloRejected") {
        rejectAndClose(socket, result);
        return;
      }

      const negotiatedCapabilities = new Set(
        result.capabilities.map((capability) => capability.name),
      );
      const supportsEnvironmentEvents =
        negotiatedCapabilities.has("environment-events");
      const supportsResnapshot = negotiatedCapabilities.has(
        "sequence-resnapshot",
      );
      resnapshotNegotiated = supportsResnapshot;
      writer.setNegotiatedContract(result.limits, supportsResnapshot);
      writer.send(result);
      helloCompleted = true;
      if (supportsEnvironmentEvents) {
        unsubscribe = state.events.subscribe((sequence) => {
          writer.send({ _tag: "EnvironmentChanged", sequence });
        });
      }
      if (
        supportsResnapshot &&
        message.lastObservedSequence !== undefined &&
        message.lastObservedSequence !== state.events.currentSequence()
      ) {
        writer.send({
          _tag: "ResnapshotRequired",
          currentSequence: state.events.currentSequence(),
          reason: "SequenceGap",
        });
      }
      return;
    }

    if (message._tag === "Hello") {
      rejectAndClose(socket, {
        _tag: "HelloRejected",
        failure: { _tag: "HandshakeAlreadyCompleted" },
      });
      return;
    }

    if (!resnapshotNegotiated) {
      rejectAndClose(socket, {
        _tag: "HelloRejected",
        failure: { _tag: "InvalidMessage" },
      });
      return;
    }

    if (!writer.acknowledgeSnapshot(message.sequence)) {
      writer.send({
        _tag: "ResnapshotRequired",
        currentSequence: state.events.currentSequence(),
        reason: "SequenceGap",
      });
      return;
    }
  });
}

function decodeMessage(data: RawData) {
  try {
    return Schema.decodeUnknownSync(EnvironmentClientMessage)(
      JSON.parse(data.toString()),
      { onExcessProperty: "error" },
    );
  } catch {
    return undefined;
  }
}

function rejectAndClose(socket: WebSocket, result: EnvironmentHelloResult) {
  if (result._tag !== "HelloRejected") {
    return;
  }

  const encoded = JSON.stringify(
    Schema.encodeSync(EnvironmentHelloResult)(result),
  );
  socket.send(encoded, (error) => {
    if (error) {
      socket.terminate();
      return;
    }
    socket.close(1008, result.failure._tag);
  });
}
