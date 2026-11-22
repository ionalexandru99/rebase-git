import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
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
  readonly sample: () => Promise<ProcessSnapshot | undefined>;
  readonly status: () => DiagnosticsMonitor;
  readonly retry: () => void;
  readonly close: () => void;
}

interface Helper {
  readonly child: ChildProcessWithoutNullStreams;
  readonly nextLine: () => Promise<string>;
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
): ProcessMonitor {
  let helper: Helper | undefined;
  let status: DiagnosticsMonitor =
    path === undefined
      ? { _tag: "Unavailable", detail: unavailable }
      : { _tag: "Starting" };
  let failed = false;
  let closed = false;
  const stopHelper = () => {
    helper?.child.kill();
    helper = undefined;
  };

  const readSample = async (path: string) => {
    helper ??= startHelper(path);
    const { child, nextLine } = helper;
    child.stdin.write("\n");
    const line = await withDeadline(nextLine());
    let parsed: Omit<ProcessSnapshot, "monitorPid">;
    try {
      parsed = JSON.parse(line) as Omit<ProcessSnapshot, "monitorPid">;
    } catch {
      throw new Error("The process monitor sent an unreadable sample.");
    }
    status = { _tag: "Running" };
    return { ...parsed, monitorPid: child.pid ?? 0 };
  };

  return {
    sample: async () => {
      if (path === undefined || failed || closed) return undefined;
      try {
        return await readSample(path);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        stopHelper();
        failed = true;
        status = { _tag: "Unavailable", detail };
        onFailure(detail);
        return undefined;
      }
    },
    status: () => status,
    retry: () => {
      failed = false;
    },
    close: () => {
      closed = true;
      stopHelper();
    },
  };
}

function withDeadline(line: Promise<string>) {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The process monitor stopped responding.")),
      sampleDeadline,
    );
  });
  return Promise.race([line, deadline]).finally(() => clearTimeout(timer));
}

function startHelper(path: string): Helper {
  const lines: string[] = [];
  let ended: Error | undefined;
  let waiting: PromiseWithResolvers<string> | undefined;
  const push = (line: string) => {
    if (ended !== undefined) return;
    if (waiting === undefined) lines.push(line);
    else waiting.resolve(line);
    waiting = undefined;
  };
  const end = (error: Error) => {
    if (ended !== undefined) return;
    ended = error;
    waiting?.reject(error);
    waiting = undefined;
  };
  const child = spawn(path, [String(process.pid)], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  createInterface({ input: child.stdout }).on("line", push);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-2_048);
  });
  child.stdin.once("error", () => undefined);
  child.once("error", end);
  child.once("exit", (code, signal) =>
    end(
      new Error(
        [
          `The process monitor stopped (${signal ?? `exit code ${code}`}).`,
          stderr.trim().split("\n").at(-1),
        ]
          .filter(Boolean)
          .join(" "),
      ),
    ),
  );
  return {
    child,
    nextLine: () => {
      const line = lines.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (ended !== undefined) return Promise.reject(ended);
      waiting = Promise.withResolvers<string>();
      return waiting.promise;
    },
  };
}
