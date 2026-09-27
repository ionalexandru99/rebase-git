import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { Effect, Exit, Scope, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import {
  EnvironmentRpc,
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
} from "#contracts/environment-connection/environment-rpc.contract.ts";

const execute = promisify(execFile);
const corpusPath = process.env.HISTORY_PROCESS_CORPUS_PATH;

test("prepared corpus stays within server and Git process budgets", async () => {
  test.skip(
    process.platform !== "linux",
    "Process RSS sampling requires Linux /proc",
  );
  test.skip(
    corpusPath === undefined,
    "Set HISTORY_PROCESS_CORPUS_PATH to a manually prepared repository",
  );
  if (corpusPath === undefined) return;
  test.setTimeout(30 * 60_000);
  const revision = (
    await execute("git", ["-C", corpusPath, "rev-parse", "HEAD"])
  ).stdout.trim();
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      resolve("tests/performance/fixtures/history-contract-server.ts"),
      corpusPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const started = await new Promise<{
    origin: string;
    repositoryId: string;
    credential: string;
    idleRssBytes: number;
  }>((resolveStart, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("\n"))
        resolveStart(JSON.parse(output.split("\n")[0] ?? ""));
    });
    child.once("exit", () => reject(new Error(stderr)));
  });
  if (child.pid === undefined) throw new Error("Server process has no PID");
  const samples = new Map<number, number>();
  let maximumServerRss = started.idleRssBytes;
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      maximumServerRss = Math.max(maximumServerRss, await rss(child.pid ?? 0));
      const children = await readFile(
        `/proc/${child.pid}/task/${child.pid}/children`,
        "utf8",
      );
      await Promise.all(
        children
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(async (value) => {
            const pid = Number(value);
            const bytes = await rss(pid);
            samples.set(pid, Math.max(samples.get(pid) ?? 0, bytes));
          }),
      );
    } catch {
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => {
    void sample();
  }, 5);
  const socket = new WebSocket(
    `${started.origin.replace("http://", "ws://")}${environmentLivePath}`,
    [environmentSubprotocol, started.credential],
  );
  const rpcScope = Effect.runSync(Scope.make());
  try {
    await new Promise<void>((resolveOpen, reject) => {
      socket.onopen = () => resolveOpen();
      socket.onerror = () => reject(new Error("WebSocket failed"));
    });
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* Socket.fromWebSocket(Effect.succeed(socket));
        const protocol = yield* RpcClient.makeProtocolSocket().pipe(
          Effect.provideService(Socket.Socket, transport),
        );
        return yield* RpcClient.make(EnvironmentRpc).pipe(
          Effect.provideService(RpcClient.Protocol, protocol),
        );
      }).pipe(
        Effect.provideService(Scope.Scope, rpcScope),
        Effect.provideService(
          RpcSerialization.RpcSerialization,
          RpcSerialization.json,
        ),
      ),
    );
    await Effect.runPromise(client.Hello({ protocol: environmentProtocol }));
    let received = 0;
    let batches = 0;
    let wireBytes = 0;
    let snapshotRoots: readonly string[] | undefined;
    const synchronizationStarted = performance.now();
    const countWireBytes = (event: MessageEvent) => {
      if (typeof event.data === "string")
        wireBytes += Buffer.byteLength(event.data);
    };
    socket.addEventListener("message", countWireBytes);
    await Effect.runPromise(
      client
        .SynchronizeHistory(
          {
            repositoryId: started.repositoryId,
            knownTips: [],
            shallowOids: [],
          },
          { streamBufferSize: 1 },
        )
        .pipe(
          Stream.runForEach((update) =>
            Effect.sync(() => {
              if (update._tag === "RepositoryHistoryTips")
                snapshotRoots = update.rootOids;
              else {
                received += update.commits.length;
                batches += 1;
              }
            }),
          ),
        ),
    );
    socket.removeEventListener("message", countWireBytes);
    await sample();
    const elapsed = performance.now() - synchronizationStarted;
    clearInterval(timer);
    if (snapshotRoots === undefined)
      throw new Error("Synchronization did not publish its snapshot");
    const count = execute("git", [
      "-C",
      corpusPath,
      "rev-list",
      "--count",
      "--stdin",
    ]);
    count.child.stdin?.end(`${snapshotRoots.join("\n")}\n`);
    const expectedCount = Number((await count).stdout.trim());
    const metrics = {
      corpusPath,
      revision,
      expectedCount,
      received,
      batches,
      wireBytes,
      synchronizationMilliseconds: elapsed,
      commitsPerSecond: received / (elapsed / 1000),
      idleServerRssBytes: started.idleRssBytes,
      maximumServerRssBytes: maximumServerRss,
      incrementalServerRssBytes: maximumServerRss - started.idleRssBytes,
      maximumGitRssBytes: Math.max(0, ...samples.values()),
      gitProcessPeakRssBytes: [...samples.values()],
      host: {
        architecture: arch(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        os: `${platform()} ${release()}`,
        node: process.version,
        git: (await execute("git", ["--version"])).stdout.trim(),
      },
    };
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
    await test.info().attach("history-process-budget.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(received).toBe(expectedCount);
    expect(metrics.maximumGitRssBytes).toBeGreaterThan(0);
    expect(metrics.incrementalServerRssBytes).toBeLessThan(128 * 1_048_576);
    expect(metrics.maximumGitRssBytes).toBeLessThan(256 * 1_048_576);
  } finally {
    clearInterval(timer);
    await Effect.runPromise(Scope.close(rpcScope, Exit.void));
    socket.close();
    child.kill("SIGTERM");
    await closed;
  }
});

async function rss(pid: number) {
  const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
  return Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
}
