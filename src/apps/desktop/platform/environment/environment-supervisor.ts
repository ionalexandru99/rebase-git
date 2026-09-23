import { fileURLToPath } from "node:url";
import { type UtilityProcess, utilityProcess } from "electron";
import type {
  EnvironmentProcessCommand,
  EnvironmentProcessMessage,
} from "#desktop/platform/environment/environment-process.contract";
import type { ManagedEnvironmentServer } from "#desktop/platform/environment/environment-supervisor.contract";

const environmentProcessPath = fileURLToPath(
  new URL("./environment-process.js", import.meta.url),
);

export function startManagedEnvironmentServer(
  onUnexpectedExit: (error: Error) => void,
): Promise<ManagedEnvironmentServer> {
  const child = utilityProcess.fork(environmentProcessPath, [], {
    serviceName: "Rebase environment",
  });
  const exited = new Promise<number>((resolve) => child.once("exit", resolve));

  return new Promise((resolve, reject) => {
    child.once("message", (message: EnvironmentProcessMessage) => {
      if (message.type === "failed") {
        child.kill();
        reject(new Error(message.message));
        return;
      }
      resolve(manageServer(child, exited, message, onUnexpectedExit));
    });
    void exited.then((code) =>
      reject(
        new Error(
          `The Rebase environment stopped before it was ready (exit code ${code}).`,
        ),
      ),
    );
  });
}

function manageServer(
  child: UtilityProcess,
  exited: Promise<number>,
  { server }: Extract<EnvironmentProcessMessage, { type: "ready" }>,
  onUnexpectedExit: (error: Error) => void,
): ManagedEnvironmentServer {
  let shutdown: Promise<void> | undefined;
  void exited.then((code) => {
    if (shutdown === undefined) {
      onUnexpectedExit(
        new Error(
          `The Rebase environment stopped unexpectedly (exit code ${code}).`,
        ),
      );
    }
  });

  return {
    ...server,
    stop: () => {
      if (shutdown === undefined) {
        if (child.pid !== undefined)
          child.postMessage({
            type: "stop",
          } satisfies EnvironmentProcessCommand);
        shutdown = exited.then(() => undefined);
      }
      return shutdown;
    },
  };
}
