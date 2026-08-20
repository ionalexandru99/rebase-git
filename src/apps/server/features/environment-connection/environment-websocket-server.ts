import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { currentTransportLimits, environmentLivePath } from "@rebase/contracts";
import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-transport.contract";
import { startEnvironmentWebSocketSession } from "@rebase/server/features/environment-connection/environment-websocket-session";
import { WebSocketServer } from "ws";

export function attachEnvironmentWebSocketServer(
  server: Server,
  state: EnvironmentTransportState,
) {
  const webSocketServer = new WebSocketServer({
    clientTracking: true,
    maxPayload: currentTransportLimits.maxWebSocketRequestBytes,
    noServer: true,
    perMessageDeflate: false,
  });
  const upgrade = (
    request: Parameters<typeof webSocketServer.handleUpgrade>[0],
    socket: Duplex,
    head: Buffer,
  ) => {
    if (request.url !== environmentLivePath) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  };

  server.on("upgrade", upgrade);
  webSocketServer.on("connection", (socket) => {
    startEnvironmentWebSocketSession(socket, state);
  });

  return {
    close: () => closeWebSocketServer(server, webSocketServer, upgrade),
  };
}

function closeWebSocketServer(
  server: Server,
  webSocketServer: WebSocketServer,
  upgrade: Parameters<Server["on"]>[1],
) {
  server.off("upgrade", upgrade);
  for (const client of webSocketServer.clients) {
    client.terminate();
  }

  return new Promise<void>((resolveClosed, rejectClosed) => {
    webSocketServer.close((error) => {
      if (error !== undefined) {
        rejectClosed(error);
      } else {
        resolveClosed();
      }
    });
  });
}
