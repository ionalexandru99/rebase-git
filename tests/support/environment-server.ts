import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";

const cliPath = resolve("src/apps/server/cli.ts");

export function startEnvironmentServer(
  homeDirectory: string,
  arguments_: readonly string[] = [],
  environment: NodeJS.ProcessEnv = {},
) {
  const inheritedEnvironment = { ...process.env };
  if (environment.PATH !== undefined) {
    for (const name of Object.keys(inheritedEnvironment)) {
      if (name.toLowerCase() === "path") delete inheritedEnvironment[name];
    }
  }
  const child = spawn(
    process.execPath,
    ["--conditions=rebase-source", cliPath, "serve", ...arguments_],
    {
      env: {
        ...inheritedEnvironment,
        BROWSER: "none",
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
        ...environment,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const waitFor = <T>(read: (output: string) => T | undefined) =>
    waitForOutput(
      child,
      () => read(stdout),
      () => stderr,
    );
  return {
    child,
    stderr: () => stderr,
    stdout: () => stdout,
    waitFor,
    waitForPairingUrl: () =>
      waitFor((output) => output.match(/^Pairing URL: (http:\/\/\S+)$/m)?.[1]),
  };
}

function waitForOutput<T>(
  child: ChildProcessWithoutNullStreams,
  read: () => T | undefined,
  readError: () => string,
) {
  return new Promise<T>((resolveOutput, rejectOutput) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectOutput(new Error("Timed out waiting for server output."));
    }, 15_000);
    const inspect = () => {
      const output = read();
      if (output !== undefined) {
        cleanup();
        resolveOutput(output);
      }
    };
    const exited = () => {
      cleanup();
      rejectOutput(
        new Error(`Server exited before it was ready. ${readError()}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      child.off("exit", exited);
    };
    child.stdout.on("data", inspect);
    child.once("exit", exited);
    inspect();
  });
}
