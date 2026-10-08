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
}

interface Helper {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: Queue.Queue<string, Error>;
}

const executable =
  process.platform === "win32"
    ? "rebase-process-monitor.exe"
    : "rebase-process-monitor";
const sampleDeadline = 5_000;

export function processMonitorPath(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const bundled = fileURLToPath(
    new URL(
      `./process-monitor/${process.platform}-${process.arch}/${executable}`,
      import.meta.url,
    ),
  );
  const candidates = [
    environment.REBASE_PROCESS_MONITOR,
    bundled.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2"),
    ...[
      `dist/${process.platform}-${process.arch}`,
      "target/release",
      "target/debug",
    ].map((folder) =>
      fileURLToPath(
        new URL(
          `../../../../../native/process-monitor/${folder}/${executable}`,
          import.meta.url,
        ),
      ),
    ),
  ];
  return candidates.find(
    (candidate) => candidate !== undefined && existsSync(candidate),
  );
}

export function acquireProcessMonitor(
  path: string | undefined,
  onFailure: (detail: string) => void,
): Effect.Effect<ProcessMonitor, never, Scope.Scope> {
  return Effect.gen(function* () {
    let helper: Helper | undefined;
    let status: DiagnosticsMonitor =
      path === undefined
        ? {
            _tag: "Unavailable",
            detail: "The process monitor isn't included in this build.",
          }
        : { _tag: "Starting" };
    const stopHelper = () => {
      helper?.child.kill();
      helper = undefined;
    };
    yield* Effect.addFinalizer(() => Effect.sync(stopHelper));

    const sample = Effect.gen(function* () {
      if (path === undefined) return undefined;
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
          status = { _tag: "Unavailable", detail };
          onFailure(detail);
          return undefined;
        }),
      ),
    );

    return { sample, status: () => status } satisfies ProcessMonitor;
  });
}

function startHelper(path: string) {
  return Effect.map(Queue.unbounded<string, Error>(), (lines): Helper => {
    const child = spawn(path, [String(process.pid)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    createInterface({ input: child.stdout }).on("line", (line) =>
      Queue.offerUnsafe(lines, line),
    );
    child.stderr.resume();
    child.stdin.once("error", () => undefined);
    child.once("error", (error) =>
      Queue.failCauseUnsafe(lines, Cause.fail(error)),
    );
    child.once("exit", (code, signal) =>
      Queue.failCauseUnsafe(
        lines,
        Cause.fail(
          new Error(
            `The process monitor stopped (${signal ?? `exit code ${code}`}).`,
          ),
        ),
      ),
    );
    return { child, lines };
  });
}
