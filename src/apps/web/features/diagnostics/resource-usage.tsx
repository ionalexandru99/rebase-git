import {
  IconActivity,
  IconCpu,
  IconGitBranch,
  IconStack2,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type {
  DiagnosticsPeriod,
  DiagnosticsProcess,
  DiagnosticsSample,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import { SettingsSection } from "#web/components/ui/settings-layout.tsx";
import {
  Choice,
  formatDuration,
  formatPercent,
  periodLabels,
} from "#web/features/diagnostics/diagnostics-primitives.tsx";
import { formatCacheSize } from "#web/features/history-storage/format-cache-size.ts";

export function Footprint({
  sample,
  period,
}: {
  readonly sample: DiagnosticsSample | undefined;
  readonly period: DiagnosticsPeriod;
}) {
  const footprint = sample?.footprint;
  const unknown = footprint === undefined ? "…" : "—";
  return (
    <SettingsSection title="Footprint">
      <div className="grid grid-cols-2 sm:grid-cols-4 [&>*]:border-border/50 [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+2)]:border-l sm:[&>*:nth-child(n+3)]:border-t-0">
        <Stat
          detail={
            footprint?.cpuPeak == null
              ? undefined
              : `Peak ${formatPercent(footprint.cpuPeak)} in the last ${periodLabels[period]}`
          }
          icon={IconCpu}
          label="Processor"
          value={
            footprint?.cpu == null ? unknown : formatPercent(footprint.cpu)
          }
        />
        <Stat
          detail={
            footprint?.memoryPeak == null
              ? undefined
              : `Peak ${formatCacheSize(footprint.memoryPeak)}`
          }
          icon={IconStack2}
          label="Memory"
          value={
            footprint?.memory == null
              ? unknown
              : formatCacheSize(footprint.memory)
          }
        />
        <Stat
          detail={busiest(sample)}
          icon={IconActivity}
          label="Processes"
          value={
            footprint === undefined ? unknown : String(footprint.processes)
          }
        />
        <Stat
          danger={(footprint?.gitFailures ?? 0) > 0}
          detail={
            footprint === undefined
              ? undefined
              : `${footprint.gitFailures} failed in the last ${periodLabels[period]}`
          }
          icon={IconGitBranch}
          label="Git runs"
          value={
            footprint === undefined ? (
              unknown
            ) : (
              <>
                {runsPerMinute(footprint.gitRuns, period)}
                <span className="text-body font-normal text-muted-foreground">
                  {" "}
                  / min
                </span>
              </>
            )
          }
        />
      </div>
    </SettingsSection>
  );
}

function busiest(sample: DiagnosticsSample | undefined) {
  const process = sample?.processes.reduce<DiagnosticsProcess | undefined>(
    (current, next) =>
      current === undefined || next.cpu > current.cpu ? next : current,
    undefined,
  );
  if (process === undefined || process.cpu < 1) return undefined;
  const name = process.kind === "Server" ? "Rebase server" : process.name;
  return `Busiest: ${name} · ${formatPercent(process.cpu)}`;
}

function runsPerMinute(runs: number, period: DiagnosticsPeriod) {
  const minutes = { "5m": 5, "15m": 15, "1h": 60 }[period];
  const rate = runs / minutes;
  return rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  danger = false,
}: {
  readonly icon: typeof IconCpu;
  readonly label: string;
  readonly value: ReactNode;
  readonly detail: string | undefined;
  readonly danger?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-4">
      <div className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </div>
      <div className="mt-2 truncate text-title font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <div
        className={`mt-1 min-h-[1lh] truncate text-meta ${danger ? "text-destructive" : "text-muted-foreground/80"}`}
      >
        {detail}
      </div>
    </div>
  );
}

export function Timeline({
  sample,
  period,
  onPeriodChange,
}: {
  readonly sample: DiagnosticsSample | undefined;
  readonly period: DiagnosticsPeriod;
  readonly onPeriodChange: (period: DiagnosticsPeriod) => void;
}) {
  const timeline = sample?.timeline;
  const cpuPeak = Math.max(0, ...(timeline?.cpu ?? []).map((cpu) => cpu ?? 0));
  const cpuScale = Math.max(5, cpuPeak);
  const runsPeak = Math.max(0, ...(timeline?.gitRuns ?? []));
  const bucketStart = (index: number) =>
    timeline === undefined || sample === undefined
      ? index
      : sample.sampledAt -
        (timeline.gitRuns.length - index) * timeline.bucketMilliseconds;
  return (
    <SettingsSection
      action={
        <Choice
          label="Timeline period"
          onChange={onPeriodChange}
          options={(["5m", "15m", "1h"] as const).map((value) => ({
            value,
            label: value,
          }))}
          value={period}
        />
      }
      title="Timeline"
    >
      <div className="space-y-3 px-4 py-4">
        <Lane label="Processor" peak={formatPercent(cpuPeak)}>
          {(timeline?.cpu ?? []).map((cpu, index) => (
            <span
              className="flex-1 rounded-t-sm bg-primary"
              key={bucketStart(index)}
              style={{
                height: `${((cpu ?? 0) / cpuScale) * 100}%`,
              }}
            />
          ))}
        </Lane>
        <Lane
          compact
          label="Git runs"
          peak={`${runsPeak} / ${formatDuration(timeline?.bucketMilliseconds ?? 0)}`}
        >
          {(timeline?.gitRuns ?? []).map((runs, index) => (
            <span
              className="flex flex-1 flex-col justify-end"
              key={bucketStart(index)}
              style={{
                height: `${runsPeak === 0 ? 0 : (runs / runsPeak) * 100}%`,
              }}
            >
              {(timeline?.gitFailures[index] ?? 0) > 0 ? (
                <span className="h-1 shrink-0 rounded-t-sm bg-destructive" />
              ) : null}
              <span className="flex-1 rounded-t-sm bg-muted-foreground/50" />
            </span>
          ))}
        </Lane>
        <div className="grid grid-cols-[4.5rem_1fr] gap-3 text-meta text-muted-foreground/70">
          <span />
          <div className="flex justify-between">
            <span>{periodLabels[period]} ago</span>
            <span>now</span>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function Lane({
  label,
  peak,
  compact = false,
  children,
}: {
  readonly label: string;
  readonly peak: string;
  readonly compact?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3">
      <div className="flex flex-col gap-0.5 text-meta">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/70 tabular-nums">{peak}</span>
      </div>
      <div
        aria-hidden="true"
        className={`flex items-end gap-1 border-b border-border/50 ${compact ? "h-10" : "h-20"}`}
      >
        {children}
      </div>
    </div>
  );
}
