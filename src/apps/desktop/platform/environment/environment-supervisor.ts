import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type UtilityProcess, utilityProcess } from "electron";
import type { EnvironmentServer } from "#server/app/server/start-environment-server.ts";

export type EnvironmentProcessMessage =
  | { readonly type: "ready"; readonly server: EnvironmentServer }
  | { readonly type: "failed"; readonly message: string };

export interface EnvironmentProcessCommand {
  readonly type: "stop";
}

export interface ManagedEnvironmentServer extends EnvironmentServer {
  stop(): Promise<void>;
}

const environmentProcessPath = fileURLToPath(
  new URL("./environment-process.js", import.meta.url),
);
const stopGraceMilliseconds = 5_000;
const loginShellPathMarker = "__REBASE_LOGIN_SHELL_PATH__";

export async function startManagedEnvironmentServer(
  onUnexpectedExit: (error: Error) => void,
): Promise<ManagedEnvironmentServer> {
  const child = utilityProcess.fork(environmentProcessPath, [], {
    serviceName: "Rebase environment",
    env: await environmentVariables(),
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

async function environmentVariables(): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== "darwin") return process.env;
  return {
    ...process.env,
    PATH: await loginShellPath(
      process.env.SHELL ?? "/bin/zsh",
      process.env.PATH,
    ),
  };
}

export function loginShellPath(
  shell: string,
  inheritedPath: string | undefined,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const probe = execFile(
      shell,
      [
        "-ilc",
        `printf '${loginShellPathMarker}%s${loginShellPathMarker}' "$PATH"`,
      ],
      { encoding: "utf8", killSignal: "SIGKILL", timeout: 5_000 },
      (_error, stdout) => {
        const [, shellPath] = stdout.split(loginShellPathMarker);
        const entries = [shellPath, inheritedPath].flatMap(
          (path) => path?.split(":") ?? [],
        );
        const path = [...new Set(entries.filter(Boolean))].join(":");
        resolve(path || undefined);
      },
    );
    probe.stdin?.end();
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
        if (child.pid !== undefined) {
          child.postMessage({
            type: "stop",
          } satisfies EnvironmentProcessCommand);
          const forceStop = setTimeout(
            () => child.kill(),
            stopGraceMilliseconds,
          );
          void exited.then(() => clearTimeout(forceStop));
        }
        shutdown = exited.then(() => undefined);
      }
      return shutdown;
    },
  };
}
