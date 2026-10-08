import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const DiagnosticsPeriod = Schema.Literals(["5m", "15m", "1h"]);
export type DiagnosticsPeriod = typeof DiagnosticsPeriod.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Milliseconds = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const Percent = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);

export const DiagnosticsProcess = Schema.Struct({
  pid: Count,
  parentPid: Schema.NullOr(Count),
  kind: Schema.Literals(["Server", "Monitor", "Git", "Process"]),
  name: Schema.String,
  command: Schema.String,
  repositoryId: Schema.optionalKey(RepositoryId),
  stoppable: Schema.Boolean,
  cpu: Percent,
  memory: Count,
  startedAt: Milliseconds,
});
export type DiagnosticsProcess = typeof DiagnosticsProcess.Type;

export const DiagnosticsMonitor = Schema.Union([
  Schema.TaggedStruct("Running", {}),
  Schema.TaggedStruct("Starting", {}),
  Schema.TaggedStruct("Unavailable", { detail: Schema.String }),
]);
export type DiagnosticsMonitor = typeof DiagnosticsMonitor.Type;

export const DiagnosticsFootprint = Schema.Struct({
  cpu: Schema.NullOr(Percent),
  cpuPeak: Schema.NullOr(Percent),
  memory: Schema.NullOr(Count),
  memoryPeak: Schema.NullOr(Count),
  processes: Count,
  gitRuns: Count,
  gitFailures: Count,
});
export type DiagnosticsFootprint = typeof DiagnosticsFootprint.Type;

export const DiagnosticsTimeline = Schema.Struct({
  bucketMilliseconds: Milliseconds,
  cpu: Schema.Array(Schema.NullOr(Percent)),
  gitRuns: Schema.Array(Count),
  gitFailures: Schema.Array(Count),
});
export type DiagnosticsTimeline = typeof DiagnosticsTimeline.Type;

export const DiagnosticsDuration = Schema.Struct({
  name: Schema.String,
  repositoryId: Schema.optionalKey(RepositoryId),
  runs: Count,
  longest: Milliseconds,
  typical: Milliseconds,
});
export type DiagnosticsDuration = typeof DiagnosticsDuration.Type;

export const DiagnosticsWatcher = Schema.Struct({
  repositoryId: RepositoryId,
  failure: Schema.optionalKey(Schema.String),
});
export type DiagnosticsWatcher = typeof DiagnosticsWatcher.Type;

export const DiagnosticsServer = Schema.Struct({
  platform: Schema.String,
  architecture: Schema.String,
  startedAt: Milliseconds,
  gitVersion: Schema.String,
  dataFolder: Schema.String,
});
export type DiagnosticsServer = typeof DiagnosticsServer.Type;

export const DiagnosticsSample = Schema.TaggedStruct("Sample", {
  sampledAt: Milliseconds,
  monitor: DiagnosticsMonitor,
  footprint: DiagnosticsFootprint,
  timeline: DiagnosticsTimeline,
  processes: Schema.Array(DiagnosticsProcess),
  slowestGit: Schema.Array(DiagnosticsDuration),
  slowestRequests: Schema.Array(DiagnosticsDuration),
  watchers: Schema.Array(DiagnosticsWatcher),
  server: DiagnosticsServer,
});
export type DiagnosticsSample = typeof DiagnosticsSample.Type;

export const DiagnosticsError = Schema.Struct({
  kind: Schema.Literals(["Server", "Git", "Watcher", "Monitor"]),
  title: Schema.String,
  where: Schema.String,
  detail: Schema.String,
  repositoryId: Schema.optionalKey(RepositoryId),
  count: Count,
  lastSeen: Milliseconds,
});
export type DiagnosticsError = typeof DiagnosticsError.Type;

export const DiagnosticsErrors = Schema.TaggedStruct("Errors", {
  errors: Schema.Array(DiagnosticsError),
});
export type DiagnosticsErrors = typeof DiagnosticsErrors.Type;

export const DiagnosticsEvent = Schema.Union([
  DiagnosticsSample,
  DiagnosticsErrors,
]);
export type DiagnosticsEvent = typeof DiagnosticsEvent.Type;

export const DiagnosticsApi = {
  watch: Rpc.make("diagnostics/watch", {
    payload: Schema.Struct({ period: DiagnosticsPeriod }),
    success: DiagnosticsEvent,
    stream: true,
  }),
  stop: route("diagnostics/stop", {
    request: Schema.Struct({ pid: Count }),
    success: Schema.Struct({}),
  }),
  watchAgain: route("diagnostics/watch-again", {
    request: Schema.Struct({ repositoryId: RepositoryId }),
    success: Schema.Struct({}),
  }),
};
