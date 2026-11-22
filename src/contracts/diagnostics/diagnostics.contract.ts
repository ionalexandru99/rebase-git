import { z } from "zod";
import {
  route,
  streamRoute,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const DiagnosticsPeriod = z.enum(["5m", "15m", "1h"]);
export type DiagnosticsPeriod = z.infer<typeof DiagnosticsPeriod>;

const Count = z.int().min(0);
const Milliseconds = z.number().min(0);
const Percent = z.number().min(0).max(100);

export const DiagnosticsProcess = z.object({
  pid: Count,
  parentPid: Count.nullable(),
  kind: z.enum(["Server", "Monitor", "Git", "Process"]),
  name: z.string(),
  command: z.string(),
  repositoryId: RepositoryId.exactOptional(),
  stoppable: z.boolean(),
  cpu: Percent,
  memory: Count,
  startedAt: Milliseconds,
});
export type DiagnosticsProcess = z.infer<typeof DiagnosticsProcess>;

export const DiagnosticsMonitor = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Running") }),
  z.object({ _tag: z.literal("Starting") }),
  z.object({ _tag: z.literal("Unavailable"), detail: z.string() }),
]);
export type DiagnosticsMonitor = z.infer<typeof DiagnosticsMonitor>;

export const DiagnosticsFootprint = z.object({
  cpu: Percent.nullable(),
  cpuPeak: Percent.nullable(),
  memory: Count.nullable(),
  memoryPeak: Count.nullable(),
  processes: Count,
  gitRuns: Count,
  gitFailures: Count,
});
export type DiagnosticsFootprint = z.infer<typeof DiagnosticsFootprint>;

export const DiagnosticsTimeline = z.object({
  bucketMilliseconds: Milliseconds,
  cpu: z.array(Percent.nullable()).readonly(),
  gitRuns: z.array(Count).readonly(),
  gitFailures: z.array(Count).readonly(),
});
export type DiagnosticsTimeline = z.infer<typeof DiagnosticsTimeline>;

export const DiagnosticsDuration = z.object({
  name: z.string(),
  repositoryId: RepositoryId.exactOptional(),
  runs: Count,
  longest: Milliseconds,
  typical: Milliseconds,
});
export type DiagnosticsDuration = z.infer<typeof DiagnosticsDuration>;

export const DiagnosticsWatcher = z.object({
  repositoryId: RepositoryId,
  failure: z.string().exactOptional(),
});
export type DiagnosticsWatcher = z.infer<typeof DiagnosticsWatcher>;

export const DiagnosticsServer = z.object({
  platform: z.string(),
  architecture: z.string(),
  startedAt: Milliseconds,
  gitVersion: z.string().nullable(),
  dataFolder: z.string(),
});
export type DiagnosticsServer = z.infer<typeof DiagnosticsServer>;

export const DiagnosticsSample = z.object({
  _tag: z.literal("Sample"),
  sampledAt: Milliseconds,
  monitor: DiagnosticsMonitor,
  footprint: DiagnosticsFootprint,
  timeline: DiagnosticsTimeline,
  processes: z.array(DiagnosticsProcess).readonly(),
  slowestGit: z.array(DiagnosticsDuration).readonly(),
  slowestRequests: z.array(DiagnosticsDuration).readonly(),
  watchers: z.array(DiagnosticsWatcher).readonly(),
  server: DiagnosticsServer,
});
export type DiagnosticsSample = z.infer<typeof DiagnosticsSample>;

export const DiagnosticsError = z.object({
  kind: z.enum(["Server", "Git", "Watcher", "Monitor"]),
  title: z.string(),
  where: z.string(),
  detail: z.string(),
  repositoryId: RepositoryId.exactOptional(),
  count: Count,
  lastSeen: Milliseconds,
});
export type DiagnosticsError = z.infer<typeof DiagnosticsError>;

export const DiagnosticsErrors = z.object({
  _tag: z.literal("Errors"),
  errors: z.array(DiagnosticsError).readonly(),
});
export type DiagnosticsErrors = z.infer<typeof DiagnosticsErrors>;

export const DiagnosticsEvent = z.discriminatedUnion("_tag", [
  DiagnosticsSample,
  DiagnosticsErrors,
]);
export type DiagnosticsEvent = z.infer<typeof DiagnosticsEvent>;

export const DiagnosticsApi = {
  watch: streamRoute("diagnostics/watch", {
    request: z.object({ period: DiagnosticsPeriod }),
    success: DiagnosticsEvent,
  }),
  stop: route("diagnostics/stop", {
    request: z.object({ pid: Count }),
    success: z.object({}),
  }),
  watchAgain: route("diagnostics/watch-again", {
    request: z.object({ repositoryId: RepositoryId }),
    success: z.object({}),
  }),
};
