import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EnvironmentDiscovery } from "@rebase/contracts";
import { Schema } from "effect";
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
      const runtimePath = join(directory, ".rebase", "runtime", "runtime.json");
      const processOutput = startCli([], directory);
      const origin = await processOutput.waitForListeningUrl();

      expect(new URL(origin).hostname).toBe("127.0.0.1");

      const response = await fetch(`${origin}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "ready" });
      await verifyBrowserAssets(origin);

      const discoveryResponse = await fetch(`${origin}/api/discovery`);
      const discovery = Schema.decodeUnknownSync(EnvironmentDiscovery)(
        await discoveryResponse.json(),
      );
      expect(discovery.environmentId).toBe(
        readEnvironmentState(
          join(directory, ".rebase", "state", "state.sqlite"),
        )?.id,
      );

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
    const runtimePath = join(directory, ".rebase", "runtime", "runtime.json");
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
            if (error) {
              rejectClosed(error);
            } else {
              resolveClosed();
            }
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
    const runtimePath = join(directory, ".rebase", "runtime", "runtime.json");
    const processOutput = startCli([], directory, { PATH: directory });

    const exit = await waitForExit(processOutput.child);

    expect(exit.code).toBe(1);
    expect(processOutput.stderr()).toContain(
      "Git 2.34 or newer is required, but Git was not found.",
    );
    expect(processOutput.stdout()).not.toContain("Listening URL:");
    await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reuses its automatic port without letting an override replace it", async () => {
    const directory = await createTemporaryDirectory();
    const statePath = join(directory, ".rebase", "state", "state.sqlite");

    const first = startCli([], directory);
    const firstOrigin = await first.waitForListeningUrl();
    const automaticPort = Number(new URL(firstOrigin).port);
    const firstState = readEnvironmentState(statePath);
    first.child.kill("SIGTERM");
    await waitForExit(first.child);

    const { explicit, explicitPort, origin } =
      await startCliOnAvailableExplicitPort(directory);
    expect(origin).toBe(`http://127.0.0.1:${explicitPort}`);
    expect(readEnvironmentState(statePath)).toEqual(firstState);
    explicit.child.kill("SIGTERM");
    await waitForExit(explicit.child);

    const restarted = startCli([], directory);
    await expect(restarted.waitForListeningUrl()).resolves.toBe(
      `http://127.0.0.1:${automaticPort}`,
    );
    expect(readEnvironmentState(statePath)).toEqual(firstState);
    restarted.child.kill("SIGTERM");
    await waitForExit(restarted.child);
  });

  it("coordinates concurrent first starts against one state database", async () => {
    const directory = await createTemporaryDirectory();
    const attempts = [startCli([], directory), startCli([], directory)];

    const outcomes = await Promise.allSettled(
      attempts.map((attempt) => attempt.waitForListeningUrl()),
    );
    const winnerIndex = outcomes.findIndex(
      (outcome) => outcome.status === "fulfilled",
    );
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);

    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = attempts[winnerIndex];
    const loser = attempts[loserIndex];
    if (winner === undefined || loser === undefined) {
      throw new Error("Expected two server attempts.");
    }

    await expect(waitForExit(loser.child)).resolves.toMatchObject({ code: 1 });
    expect(loser.stderr()).toMatch(
      /already in use|Another server selected automatic port/,
    );
    expect(loser.stderr()).not.toContain("migration");

    winner.child.kill("SIGTERM");
    await waitForExit(winner.child);
  });
});

function readEnvironmentState(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  const environment = database
    .prepare("SELECT id, automatic_port AS automaticPort FROM environment")
    .get();
  database.close();
  return environment;
}

async function verifyBrowserAssets(origin: string) {
  const entryResponse = await fetch(`${origin}/pair`);
  expect(entryResponse.status).toBe(200);
  expect(entryResponse.headers.get("cache-control")).toBe("no-store");
  expect(entryResponse.headers.get("content-type")).toBe(
    "text/html; charset=utf-8",
  );

  const entry = await entryResponse.text();
  const assetReference = entry.match(
    /(?:href|src)="([^"]*assets\/[^"]+)"/,
  )?.[1];
  if (assetReference === undefined) {
    throw new Error("Expected the browser entry point to reference an asset.");
  }

  const assetUrl = new URL(assetReference, `${origin}/pair`);
  expect(assetUrl.origin).toBe(origin);
  const assetResponse = await fetch(assetUrl);
  expect(assetResponse.status).toBe(200);
  expect(assetResponse.headers.get("cache-control")).toBe(
    "public, max-age=31536000, immutable",
  );

  const headResponse = await fetch(`${origin}/pair`, { method: "HEAD" });
  expect(headResponse.status).toBe(200);
  await expect(headResponse.text()).resolves.toBe("");

  const rejectedMethodResponse = await fetch(`${origin}/pair`, {
    method: "POST",
  });
  expect(rejectedMethodResponse.status).toBe(405);
  expect(rejectedMethodResponse.headers.get("allow")).toBe("GET, HEAD");

  expect((await fetch(`${origin}/favicon.svg`)).status).toBe(200);
  expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404);
  expect((await fetch(`${origin}/assets/`)).status).toBe(404);
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise<void>((resolveListening) => {
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the port probe to have a TCP address.");
  }
  await new Promise<void>((resolveClosed, rejectClosed) => {
    server.close((error) => {
      if (error) {
        rejectClosed(error);
      } else {
        resolveClosed();
      }
    });
  });
  return address.port;
}

async function startCliOnAvailableExplicitPort(homeDirectory: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const explicitPort = await findAvailablePort();
    const explicit = startCli(["--port", String(explicitPort)], homeDirectory);
    try {
      const origin = await explicit.waitForListeningUrl();
      return { explicit, explicitPort, origin };
    } catch (error) {
      await waitForExit(explicit.child);
      if (!explicit.stderr().includes("already in use") || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Could not reserve an explicit test port.");
}

function startCli(
  arguments_: string[],
  homeDirectory: string,
  environment: NodeJS.ProcessEnv = {},
) {
  const inheritedEnvironment = { ...process.env };
  if (environment.PATH !== undefined) {
    for (const name of Object.keys(inheritedEnvironment)) {
      if (name.toLowerCase() === "path") {
        delete inheritedEnvironment[name];
      }
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
  if (
    (child.exitCode !== null || child.signalCode !== null) &&
    child.stderr.readableEnded
  ) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        rejectExit(new Error("Timed out waiting for process exit."));
      }, 10_000);

      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolveExit({ code, signal });
      });
    },
  );
}
