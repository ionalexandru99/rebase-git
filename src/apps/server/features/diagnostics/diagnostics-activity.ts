import { basename } from "node:path";
import type {
  DiagnosticsDuration,
  DiagnosticsError,
  DiagnosticsPeriod,
} from "#contracts/diagnostics/diagnostics.contract.ts";

export interface GitRunStart {
  readonly directory: string;
  readonly arguments: readonly string[];
  readonly repositoryId: string | undefined;
  readonly expectedExitCodes?: readonly number[];
}

export type GitRunOutcome =
  | {
      readonly _tag: "Exited";
      readonly exitCode: number;
      readonly stderr: string;
    }
  | {
      readonly _tag: "Failed";
      readonly reason: string;
      readonly detail: string;
    }
  | { readonly _tag: "Interrupted" };

export interface GitRunHandle {
  readonly spawned: (pid: number, stop: () => void) => void;
  readonly finished: (outcome: GitRunOutcome) => void;
}

export interface RunningGit {
  readonly command: string;
  readonly repositoryId: string | undefined;
  readonly startedAt: number;
  readonly stop: () => void;
}

export type ReportedError = Omit<DiagnosticsError, "count" | "lastSeen">;

export interface DiagnosticsActivity {
  readonly gitStarted: (run: GitRunStart) => GitRunHandle;
  readonly requestFinished: (
    procedure: string,
    repositoryId: string | undefined,
    duration: number,
  ) => void;
  readonly reportError: (error: ReportedError) => void;
  readonly running: () => ReadonlyMap<number, RunningGit>;
  readonly stop: (pid: number) => void;
  readonly gitSummary: (period: DiagnosticsPeriod) => GitSummary;
  readonly slowestGit: () => readonly DiagnosticsDuration[];
  readonly slowestRequests: () => readonly DiagnosticsDuration[];
  readonly errors: () => readonly DiagnosticsError[];
  readonly onErrorsChanged: (listener: () => void) => () => void;
}

export interface GitSummary {
  readonly runs: number;
  readonly failures: number;
  readonly runsPerBucket: readonly number[];
  readonly failuresPerBucket: readonly number[];
}

interface FinishedRun {
  readonly name: string;
  readonly repositoryId: string | undefined;
  readonly startedAt: number;
  readonly duration: number;
  readonly failed: boolean;
}

export const periods: Readonly<
  Record<
    DiagnosticsPeriod,
    { readonly window: number; readonly bucket: number }
  >
> = {
  "5m": { window: 5 * 60_000, bucket: 10_000 },
  "15m": { window: 15 * 60_000, bucket: 30_000 },
  "1h": { window: 60 * 60_000, bucket: 120_000 },
};

const failureVerbs: Readonly<Record<string, string>> = {
  GitUnavailable: "couldn't start",
  OutputTooLarge: "returned too much output",
  Timeout: "timed out",
};
const retention = 60 * 60_000;
const maximumRecords = 50_000;
const maximumErrors = 50;
const maximumDetail = 8_192;
const slowestCount = 10;

export function createDiagnosticsActivity(): DiagnosticsActivity {
  const now = Date.now;
  const running = new Map<number, RunningGit>();
  const gitRuns: FinishedRun[] = [];
  const requests: FinishedRun[] = [];
  const errors = new Map<string, DiagnosticsError>();
  const errorListeners = new Set<() => void>();

  const reportError = (error: ReportedError) => {
    const key = `${error.kind}\u0000${error.title}\u0000${error.where}`;
    const previous = errors.get(key);
    errors.delete(key);
    errors.set(key, {
      ...error,
      detail: error.detail.slice(0, maximumDetail),
      count: (previous?.count ?? 0) + 1,
      lastSeen: now(),
    });
    if (errors.size > maximumErrors) {
      const oldest = errors.keys().next().value;
      if (oldest !== undefined) errors.delete(oldest);
    }
    for (const listener of errorListeners) listener();
  };

  return {
    gitStarted: (run) => {
      const startedAt = now();
      const started = performance.now();
      const name = gitCommandName(run.arguments);
      let pid: number | undefined;
      let entry: RunningGit | undefined;
      let stopped = false;
      return {
        spawned: (spawnedPid, stop) => {
          pid = spawnedPid;
          entry = {
            command: name,
            repositoryId: run.repositoryId,
            startedAt,
            stop: () => {
              stopped = true;
              stop();
            },
          };
          running.set(spawnedPid, entry);
        },
        finished: (outcome) => {
          if (pid !== undefined && running.get(pid) === entry)
            running.delete(pid);
          const failed =
            !stopped && isGitFailure(outcome, run.expectedExitCodes);
          remember(gitRuns, {
            name,
            repositoryId: run.repositoryId,
            startedAt,
            duration: performance.now() - started,
            failed,
          });
          if (failed)
            reportError(gitError(name, run, outcome as FailedOutcome));
        },
      };
    },
    requestFinished: (procedure, repositoryId, duration) =>
      remember(requests, {
        name: procedure,
        repositoryId,
        startedAt: now() - duration,
        duration,
        failed: false,
      }),
    reportError,
    running: () => running,
    stop: (pid) => running.get(pid)?.stop(),
    gitSummary: (period) => summarizeRuns(gitRuns, period, now()),
    slowestGit: () => slowest(gitRuns, now()),
    slowestRequests: () => slowest(requests, now()),
    errors: () => [...errors.values()].reverse(),
    onErrorsChanged: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  };

  function remember(records: FinishedRun[], record: FinishedRun) {
    records.push(record);
    const oldest = record.startedAt - retention;
    let expired = 0;
    while (
      expired < records.length &&
      ((records[expired]?.startedAt ?? 0) < oldest ||
        records.length - expired > maximumRecords)
    )
      expired += 1;
    if (expired > 0) records.splice(0, expired);
  }
}

function gitCommandName(arguments_: readonly string[]) {
  const end = arguments_.indexOf("--");
  const [subcommand, ...rest] =
    end === -1 ? arguments_ : arguments_.slice(0, end);
  const options = rest
    .filter((argument) => argument.startsWith("-"))
    .map((option) => option.replace(/=.*$/s, ""));
  return ["git", subcommand ?? "", ...options].join(" ").slice(0, 120).trim();
}

type FailedOutcome = Exclude<GitRunOutcome, { readonly _tag: "Interrupted" }>;

function isGitFailure(
  outcome: GitRunOutcome,
  expectedExitCodes: readonly number[] | undefined,
) {
  return (
    outcome._tag === "Failed" ||
    (outcome._tag === "Exited" &&
      expectedExitCodes !== undefined &&
      !expectedExitCodes.includes(outcome.exitCode))
  );
}

function gitError(
  name: string,
  run: GitRunStart,
  outcome: FailedOutcome,
): ReportedError {
  const detail =
    outcome._tag === "Exited" ? outcome.stderr.trim() : outcome.detail;
  return {
    kind: "Git",
    title:
      outcome._tag === "Exited"
        ? `${name} exited with ${outcome.exitCode}`
        : `${name} ${failureVerbs[outcome.reason] ?? "failed"}`,
    where: detail.split("\n")[0]?.trim() || basename(run.directory),
    detail,
    ...(run.repositoryId === undefined
      ? {}
      : { repositoryId: run.repositoryId }),
  };
}

function summarizeRuns(
  runs: readonly FinishedRun[],
  period: DiagnosticsPeriod,
  at: number,
): GitSummary {
  const { window, bucket } = periods[period];
  const count = window / bucket;
  const runsPerBucket = Array.from({ length: count }, () => 0);
  const failuresPerBucket = Array.from({ length: count }, () => 0);
  const start = at - window;
  let total = 0;
  let failures = 0;
  for (const run of runs) {
    if (run.startedAt < start) continue;
    const index = Math.min(
      count - 1,
      Math.floor((run.startedAt - start) / bucket),
    );
    runsPerBucket[index] = (runsPerBucket[index] ?? 0) + 1;
    total += 1;
    if (run.failed) {
      failuresPerBucket[index] = (failuresPerBucket[index] ?? 0) + 1;
      failures += 1;
    }
  }
  return { runs: total, failures, runsPerBucket, failuresPerBucket };
}

function slowest(
  runs: readonly FinishedRun[],
  at: number,
): readonly DiagnosticsDuration[] {
  const groups = new Map<
    string,
    { name: string; repositoryId: string | undefined; durations: number[] }
  >();
  for (const run of runs) {
    if (run.startedAt < at - retention) continue;
    const key = `${run.repositoryId ?? ""}\u0000${run.name}`;
    const group = groups.get(key) ?? {
      name: run.name,
      repositoryId: run.repositoryId,
      durations: [],
    };
    group.durations.push(run.duration);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ name, repositoryId, durations }) => {
      const sorted = durations.toSorted((left, right) => left - right);
      return {
        name,
        ...(repositoryId === undefined ? {} : { repositoryId }),
        runs: sorted.length,
        longest: sorted.at(-1) ?? 0,
        typical: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0,
      };
    })
    .toSorted((left, right) => right.longest - left.longest)
    .slice(0, slowestCount);
}
