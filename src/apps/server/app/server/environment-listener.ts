import { createServer, type Server } from "node:http";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  createEnvironmentHttpHandler,
  type EnvironmentControl,
} from "#server/adapters/environment-transport/environment-http-handler.ts";
import { formatHostAddress } from "#server/adapters/environment-transport/environment-request-authorization.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  attachEnvironmentSocket,
  environmentRouter,
} from "#server/adapters/environment-transport/environment-socket.ts";
import { acquireScoped } from "#server/app/server/resource-scope.ts";
import { errorMessage, isFileSystemError } from "#server/error-inspection.ts";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.ts";

export interface EnvironmentListener {
  readonly host: string;
  readonly origin: string;
  readonly port: number;
  readonly server: Server;
}

interface EnvironmentListenerOptions {
  readonly authorization: EnvironmentAuthorization;
  readonly browserAssetsRoot?: string;
  readonly control: EnvironmentControl;
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly features: EnvironmentFeature;
  readonly host?: string;
  readonly port?: number;
  readonly reportDefect?: (where: string, error: unknown) => void;
}

const loopbackHost = "127.0.0.1";

export function acquireEnvironmentListener(
  options: EnvironmentListenerOptions,
) {
  const host = options.host ?? loopbackHost;
  const port = options.port ?? 0;
  return acquireScoped(async (scope) => {
    try {
      const server = createServer(
        { maxHeaderSize: 16_384 },
        createEnvironmentHttpHandler(options),
      );
      scope.defer(() => closeServer(server));
      scope.use(
        attachEnvironmentSocket(
          server,
          environmentRouter(options),
          options.authorization,
          options.reportDefect ?? (() => undefined),
        ),
      );
      await listen(server, host, port);
      const listeningPort = readListeningPort(server);
      return {
        host,
        origin: `http://${formatHostAddress(host)}:${listeningPort}`,
        port: listeningPort,
        server,
      } satisfies EnvironmentListener;
    } catch (cause) {
      throw new Error(listenerErrorMessage(cause, host, port), { cause });
    }
  });
}

function readListeningPort(server: Server) {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The HTTP listener has no TCP address.");
  }
  return address.port;
}

function listen(server: Server, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const failed = (cause: unknown) => {
      detach();
      reject(cause);
    };
    const listening = () => {
      detach();
      resolve();
    };
    const detach = () => {
      server.off("error", failed);
      server.off("listening", listening);
    };

    server.once("error", failed);
    server.once("listening", listening);
    try {
      server.listen({ exclusive: true, host, port });
    } catch (cause) {
      failed(cause);
    }
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClosed, rejectClosed) => {
    server.close((error) => {
      if (error && !isServerNotRunning(error)) {
        rejectClosed(error);
      } else {
        resolveClosed();
      }
    });
    server.closeAllConnections();
  });
}

function isServerNotRunning(error: unknown) {
  return isFileSystemError(error) && error.code === "ERR_SERVER_NOT_RUNNING";
}

function listenerErrorMessage(cause: unknown, host: string, port: number) {
  if (isFileSystemError(cause) && cause.code === "EADDRINUSE" && port !== 0) {
    return `Port ${port} is already in use on ${host}.`;
  }
  if (isFileSystemError(cause) && cause.code === "EADDRNOTAVAIL") {
    return `Address ${host} is not available on this machine.`;
  }

  return `Could not start the Environment server: ${errorMessage(cause)}`;
}
