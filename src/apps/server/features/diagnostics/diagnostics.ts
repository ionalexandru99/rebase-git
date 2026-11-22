import { homedir } from "node:os";
import { basename } from "node:path";
import {
  DiagnosticsApi,
  type DiagnosticsErrors,
  type DiagnosticsPeriod,
  type DiagnosticsProcess,
  type DiagnosticsSample,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import {
  type EnvironmentFeature,
  route,
  stream,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  type DiagnosticsActivity,
  periods,
} from "#server/features/diagnostics/diagnostics-activity.ts";
import type {
  ProcessMonitor,
  ProcessSnapshot,
} from "#server/features/diagnostics/process-monitor.ts";
import type { RepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher.ts";

interface DiagnosticsDependencies {
  readonly activity: DiagnosticsActivity;
  readonly monitor: ProcessMonitor;
  readonly changes: RepositoryChangePublisher;
  readonly dataFolder: string;
  readonly git: GitCommandRunner;
}

interface Footprint {
  readonly at: number;
  readonly cpu: number;
  readonly memory: number;
}

const watchedInterval = 1_000;
const backgroundInterval = 10_000;
const footprintRetention = 60 * 60_000;

export function acquireDiagnosticsFeature({
  activity,
  monitor,
  changes,
  dataFolder,
  git,
}: DiagnosticsDependencies) {
  const startedAt = Date.now() - process.uptime() * 1_000;
  const stopped = new AbortController();
  const footprints: Footprint[] = [];
  const sampledListeners = new Set<() => void>();
  let latest: ProcessSnapshot | undefined;
  let gitVersion: string | null = null;
  let gitVersionRead: Promise<void> | undefined;
  let watching = 0;
  let wakePending = false;
  let wakeTick: (() => void) | undefined;

  const publishSampled = () => {
    for (const listener of sampledListeners) listener();
  };

  const readGitVersion = () => {
    gitVersionRead ??= git
      .run({
        directory: homedir(),
        arguments: ["--version"],
        signal: stopped.signal,
      })
      .then(
        ({ stdout }) => /git version (\S+)/.exec(stdout)?.[1] ?? "Unknown",
        () => "Unknown",
      )
      .then((version) => {
        gitVersion = version;
        publishSampled();
      });
    return gitVersionRead;
  };

  const sample = async () => {
    latest = await monitor.sample();
    if (latest !== undefined) {
      const at = Date.now();
      footprints.push({ at, ...totals(latest) });
      while ((footprints[0]?.at ?? at) < at - footprintRetention)
        footprints.shift();
    }
    publishSampled();
  };

  const wake = () => {
    if (wakeTick === undefined) wakePending = true;
    else wakeTick();
  };

  const nextTick = () =>
    new Promise<void>((resolve) => {
      if (wakePending) {
        wakePending = false;
        resolve();
        return;
      }
      const timer = setTimeout(
        () => wakeTick?.(),
        watching > 0 ? watchedInterval : backgroundInterval,
      );
      wakeTick = () => {
        clearTimeout(timer);
        wakeTick = undefined;
        resolve();
      };
    });

  void (async () => {
    while (true) {
      await nextTick();
      if (stopped.signal.aborted) return;
      await sample();
    }
  })();

  const describe = (period: DiagnosticsPeriod): DiagnosticsSample => {
    const now = Date.now();
    const { window, bucket } = periods[period];
    const recent = footprints.filter(({ at }) => at >= now - window);
    const git = activity.gitSummary(period);
    const current = latest === undefined ? undefined : totals(latest);
    return {
      _tag: "Sample",
      sampledAt: now,
      monitor: monitor.status(),
      footprint: {
        cpu: current?.cpu ?? null,
        cpuPeak: peak(recent.map(({ cpu }) => cpu)),
        memory: current?.memory ?? null,
        memoryPeak: peak(recent.map(({ memory }) => memory)),
        processes: latest?.processes.length ?? 0,
        gitRuns: git.runs,
        gitFailures: git.failures,
      },
      timeline: {
        bucketMilliseconds: bucket,
        cpu: git.runsPerBucket.map((_, index) => {
          const start = now - window + index * bucket;
          return peak(
            recent
              .filter(({ at }) => at >= start && at < start + bucket)
              .map(({ cpu }) => cpu),
          );
        }),
        gitRuns: git.runsPerBucket,
        gitFailures: git.failuresPerBucket,
      },
      processes:
        latest === undefined ? [] : describeProcesses(latest, activity),
      slowestGit: activity.slowestGit(),
      slowestRequests: activity.slowestRequests(),
      watchers: changes.watchers(),
      server: {
        platform: process.platform,
        architecture: process.arch,
        startedAt,
        gitVersion,
        dataFolder,
      },
    };
  };

  const errors = (): DiagnosticsErrors => ({
    _tag: "Errors",
    errors: activity.errors(),
  });

  async function* watch(period: DiagnosticsPeriod, signal: AbortSignal) {
    let errorsChanged = true;
    let sampled = true;
    let notify: (() => void) | undefined;
    watching += 1;
    monitor.retry();
    const onSampled = () => {
      sampled = true;
      notify?.();
    };
    sampledListeners.add(onSampled);
    const releaseErrors = activity.onErrorsChanged(() => {
      errorsChanged = true;
      notify?.();
    });
    const abort = () => notify?.();
    signal.addEventListener("abort", abort);
    void readGitVersion();
    wake();
    try {
      while (!signal.aborted) {
        if (errorsChanged) {
          errorsChanged = false;
          yield errors();
        } else if (sampled) {
          sampled = false;
          yield describe(period);
        } else
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
      }
    } finally {
      watching -= 1;
      sampledListeners.delete(onSampled);
      releaseErrors();
      signal.removeEventListener("abort", abort);
    }
  }

  const feature: EnvironmentFeature = {
    routes: [
      route(DiagnosticsApi.stop, async ({ pid }) => {
        const run = activity.running().get(pid);
        if (run === undefined) return {};
        for (const descendant of descendantsOf(latest, pid, run.startedAt)) {
          try {
            process.kill(descendant);
          } catch {}
        }
        activity.stop(pid);
        return {};
      }),
      route(DiagnosticsApi.watchAgain, async ({ repositoryId }) => {
        await changes.restart(repositoryId);
        return {};
      }),
      stream(DiagnosticsApi.watch, ({ period }, { signal }) =>
        watch(period, signal),
      ),
    ],
  };

  return {
    feature,
    close: () => {
      stopped.abort();
      wakeTick?.();
    },
  };
}

function descendantsOf(
  snapshot: ProcessSnapshot | undefined,
  pid: number,
  since: number,
) {
  const earliest = Math.floor(since / 1_000) * 1_000;
  const found: number[] = [];
  const pending = [pid];
  while (pending.length > 0) {
    const parent = pending.pop();
    for (const process of snapshot?.processes ?? [])
      if (
        process.parentPid === parent &&
        process.startedAt >= earliest &&
        !found.includes(process.pid)
      ) {
        found.push(process.pid);
        pending.push(process.pid);
      }
  }
  return found.reverse();
}

function totals(snapshot: ProcessSnapshot) {
  const total = snapshot.processes.reduce(
    (sum, process) => ({
      cpu: sum.cpu + machineShare(process.cpu, snapshot.processors),
      memory: sum.memory + process.memory,
    }),
    { cpu: 0, memory: 0 },
  );
  return { ...total, cpu: Math.min(100, total.cpu) };
}

function machineShare(cpu: number, processors: number) {
  return Math.min(100, Math.max(0, cpu / Math.max(1, processors)));
}

function peak(values: readonly number[]) {
  return values.length === 0 ? null : Math.max(...values);
}

function describeProcesses(
  snapshot: ProcessSnapshot,
  activity: DiagnosticsActivity,
): readonly DiagnosticsProcess[] {
  const running = activity.running();
  return snapshot.processes.map((process) => {
    const run = running.get(process.pid);
    const [program = process.name, ...rest] = process.command;
    return {
      pid: process.pid,
      parentPid: process.parentPid,
      kind:
        process.pid === globalThis.process.pid
          ? "Server"
          : process.pid === snapshot.monitorPid
            ? "Monitor"
            : run !== undefined || /^git(?:[-.]|$)/i.test(process.name)
              ? "Git"
              : "Process",
      name: process.name,
      command: (run?.command ?? [basename(program), ...rest].join(" ")).slice(
        0,
        300,
      ),
      ...(run?.repositoryId === undefined
        ? {}
        : { repositoryId: run.repositoryId }),
      stoppable: run !== undefined,
      cpu: machineShare(process.cpu, snapshot.processors),
      memory: process.memory,
      startedAt: process.startedAt,
    };
  });
}
