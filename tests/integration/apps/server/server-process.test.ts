import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const cliPath = resolve("src/apps/server/cli.ts");
const children = new Set<ChildProcessWithoutNullStreams>();
const directories = new Set<string>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child);
    }
  }

  for (const directory of directories) {
    await rm(directory, { force: true, recursive: true });
  }

  children.clear();
  directories.clear();
});

describe("rebase serve", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "starts a ready loopback server and stops on %s",
    async (signal) => {
      const directory = await createTemporaryDirectory();
      const runtimePath = join(directory, ".rebase", "runtime.json");
      const processOutput = startCli([], directory);
      const origin = await processOutput.waitForListeningUrl();

      expect(new URL(origin).hostname).toBe("127.0.0.1");

      const response = await fetch(`${origin}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "ready" });

      const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
      expect(runtime).toMatchObject({
        origin,
        pid: processOutput.child.pid,
      });

      expect(processOutput.stdout()).toContain(`Pairing URL: ${origin}/pair`);

      processOutput.child.kill(signal);
      const forceKilledByWindows = process.platform === "win32";
      await expect(waitForExit(processOutput.child)).resolves.toMatchObject({
        code: forceKilledByWindows ? null : 0,
        signal: forceKilledByWindows ? signal : null,
      });
      if (forceKilledByWindows) {
        await expect(access(runtimePath)).resolves.toBeUndefined();
      } else {
        await expect(access(runtimePath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    },
  );

  it("fails clearly when an explicit port is occupied", async () => {
    const directory = await createTemporaryDirectory();
    const runtimePath = join(directory, ".rebase", "runtime.json");
    const occupiedServer = createServer();
    await new Promise<void>((resolveListening) => {
      occupiedServer.listen(0, "127.0.0.1", resolveListening);
    });

    const address = occupiedServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected the occupied server to have a TCP address.");
    }

    const processOutput = startCli(["--port", String(address.port)], directory);
    const exit = await waitForExit(processOutput.child).finally(
      () =>
        new Promise<void>((resolveClosed, rejectClosed) => {
          occupiedServer.close((error) => {
            if (error) rejectClosed(error);
            else resolveClosed();
          });
        }),
    );

    expect(exit.code).toBe(1);
    expect(processOutput.stderr()).toContain(
      `Port ${address.port} is already in use on 127.0.0.1.`,
    );
    expect(processOutput.stdout()).not.toContain("Listening URL:");
    await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails before reporting ready when Git is unavailable", async () => {
    const directory = await createTemporaryDirectory();
    const runtimePath = join(directory, ".rebase", "runtime.json");
    const processOutput = startCli([], directory, { PATH: directory });

    const exit = await waitForExit(processOutput.child);

    expect(exit.code).toBe(1);
    expect(processOutput.stderr()).toContain(
      "Git 2.34 or newer is required, but Git was not found.",
    );
    expect(processOutput.stdout()).not.toContain("Listening URL:");
    await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function startCli(
  arguments_: string[],
  homeDirectory: string,
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
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
        ...environment,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.add(child);

  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  return {
    child,
    stderr: () => stderr,
    stdout: () => stdout,
    waitForListeningUrl: () =>
      waitForOutput(
        child,
        () => {
          const match = stdout.match(/^Listening URL: (http:\/\/[^\s]+)$/m);
          const origin = match?.[1];
          return origin && stdout.includes(`Pairing URL: ${origin}/pair`)
            ? origin
            : undefined;
        },
        () => stderr,
      ),
  };
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase server șț "));
  directories.add(directory);
  return directory;
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
    }, 10_000);

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

function waitForExit(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        rejectExit(new Error("Timed out waiting for process exit."));
      }, 10_000);

      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolveExit({ code, signal });
      });
    },
  );
}
