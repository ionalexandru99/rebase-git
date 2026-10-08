import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Queue, type Scope } from "effect";
import type { DiagnosticsMonitor } from "#contracts/diagnostics/diagnostics.contract.ts";

export interface MonitoredProcess {
  readonly pid: number;
  readonly parentPid: number | null;
  readonly name: string;
  readonly command: readonly string[];
  readonly cpu: number;
  readonly memory: number;
  readonly startedAt: number;
}

export interface ProcessSnapshot {
  readonly processors: number;
  readonly processes: readonly MonitoredProcess[];
  readonly monitorPid: number;
}

export interface ProcessMonitor {
  readonly sample: Effect.Effect<ProcessSnapshot | undefined>;
  readonly status: () => DiagnosticsMonitor;
  readonly retry: () => void;
}

interface Helper {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: Queue.Queue<string, Error>;
}

const unavailable = "The process monitor isn't included in this build.";

const executable =
  process.platform === "win32"
    ? "rebase-process-monitor.exe"
    : "rebase-process-monitor";
const sampleDeadline = 5_000;

export function processMonitorPath() {
  const key = `${process.platform}-${process.arch}`;
  const candidates = [
    `./process-monitor/${key}/${executable}`,
    `../../../../../native/process-monitor/dist/${key}/${executable}`,
  ].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)).replace(
      /([\\/])app\.asar([\\/])/,
      "$1app.asar.unpacked$2",
    ),
  );
  return candidates.find((candidate) => existsSync(candidate));
}

export function acquireProcessMonitor(
  path: string | undefined,
  onFailure: (detail: string) => void,
): Effect.Effect<ProcessMonitor, never, Scope.Scope> {
  return Effect.gen(function* () {
    let helper: Helper | undefined;
    let status: DiagnosticsMonitor =
      path === undefined
        ? { _tag: "Unavailable", detail: unavailable }
        : { _tag: "Starting" };
    let failed = false;
    const stopHelper = () => {
      helper?.child.kill();
      helper = undefined;
    };
    yield* Effect.addFinalizer(() => Effect.sync(stopHelper));

    const sample = Effect.gen(function* () {
      if (path === undefined || failed) return undefined;
      if (helper === undefined) helper = yield* startHelper(path);
      const { child, lines } = helper;
      child.stdin.write("\n");
      const line = yield* Queue.take(lines).pipe(
        Effect.timeoutOrElse({
          duration: sampleDeadline,
          orElse: () =>
            Effect.fail(new Error("The process monitor stopped responding.")),
        }),
      );
      const parsed = yield* Effect.try({
        try: () => JSON.parse(line) as Omit<ProcessSnapshot, "monitorPid">,
        catch: () =>
          new Error("The process monitor sent an unreadable sample."),
      });
      status = { _tag: "Running" };
      return { ...parsed, monitorPid: child.pid ?? 0 };
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const detail = error instanceof Error ? error.message : String(error);
          stopHelper();
          failed = true;
          status = { _tag: "Unavailable", detail };
          onFailure(detail);
          return undefined;
        }),
      ),
    );

    return {
      sample,
      status: () => status,
      retry: () => {
        failed = false;
      },
    } satisfies ProcessMonitor;
  });
}

function startHelper(path: string) {
  return Effect.flatMap(Queue.unbounded<string, Error>(), (lines) =>
    Effect.try({
      try: (): Helper => {
        const child = spawn(path, [String(process.pid)], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        let stderr = "";
        createInterface({ input: child.stdout }).on("line", (line) =>
          Queue.offerUnsafe(lines, line),
        );
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-2_048);
        });
        child.stdin.once("error", () => undefined);
        child.once("error", (error) =>
          Queue.failCauseUnsafe(lines, Cause.fail(error)),
        );
        child.once("exit", (code, signal) =>
          Queue.failCauseUnsafe(
            lines,
            Cause.fail(
              new Error(
                [
                  `The process monitor stopped (${signal ?? `exit code ${code}`}).`,
                  stderr.trim().split("\n").at(-1),
                ]
                  .filter(Boolean)
                  .join(" "),
              ),
            ),
          ),
        );
        return { child, lines };
      },
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  );
}
