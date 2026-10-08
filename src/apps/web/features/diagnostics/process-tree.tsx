import {
  IconChevronDown,
  IconChevronRight,
  IconGauge,
  IconGitBranch,
  IconPlayerStopFilled,
  IconServer,
  IconTerminal2,
} from "@tabler/icons-react";
import { useState } from "react";
import type {
  DiagnosticsProcess,
  DiagnosticsSample,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { SettingsSection } from "#web/components/ui/settings-layout.tsx";
import {
  formatDuration,
  formatPercent,
  RepositoryMark,
} from "#web/features/diagnostics/diagnostics-primitives.tsx";
import { formatCacheSize } from "#web/features/history-storage/format-cache-size.ts";

const kindIcons = {
  Server: IconServer,
  Monitor: IconGauge,
  Git: IconGitBranch,
  Process: IconTerminal2,
} as const;

const columns =
  "grid grid-cols-[minmax(0,1fr)_5.5rem_3.5rem_4.5rem_4rem_4rem] items-center gap-x-3";

interface ProcessRow {
  readonly process: DiagnosticsProcess;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export function Processes({
  sample,
  onStop,
}: {
  readonly sample: DiagnosticsSample | undefined;
  readonly onStop: (process: DiagnosticsProcess) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const rows =
    sample === undefined ? [] : processRows(sample.processes, collapsed);
  const unavailable =
    sample?.monitor._tag === "Unavailable" ? sample.monitor.detail : undefined;
  return (
    <SettingsSection title="Processes">
      {unavailable === undefined ? (
        <div className={`${columns} px-4 py-2 text-meta text-muted-foreground`}>
          <span>Process</span>
          <span className="text-right">Running</span>
          <span className="text-right">CPU</span>
          <span className="text-right">Memory</span>
          <span className="text-right">PID</span>
          <span />
        </div>
      ) : (
        <p className="px-4 py-3 text-meta text-muted-foreground" role="status">
          {unavailable}
        </p>
      )}
      {rows.map(({ process, depth, hasChildren }) => {
        const Icon = kindIcons[process.kind];
        const label =
          process.kind === "Server"
            ? "Rebase server"
            : process.kind === "Monitor"
              ? "Process monitor"
              : process.command;
        const open = !collapsed.has(process.pid);
        return (
          <div className={`${columns} px-4 py-1.5`} key={process.pid}>
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: `${depth * 1.25}rem` }}
            >
              {hasChildren ? (
                <Button
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
                  className="-m-1 size-5 text-muted-foreground sm:size-5"
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (open) next.add(process.pid);
                      else next.delete(process.pid);
                      return next;
                    })
                  }
                  size="icon-xs"
                  variant="ghost"
                >
                  {open ? (
                    <IconChevronDown aria-hidden="true" className="size-3.5" />
                  ) : (
                    <IconChevronRight aria-hidden="true" className="size-3.5" />
                  )}
                </Button>
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span
                className={`truncate ${process.kind === "Server" || process.kind === "Monitor" ? "text-control font-medium" : "font-mono text-meta"}`}
              >
                {label}
              </span>
              <RepositoryMark repositoryId={process.repositoryId} small />
            </div>
            <span className="text-right text-meta text-muted-foreground tabular-nums">
              {formatDuration(
                Math.max(0, (sample?.sampledAt ?? 0) - process.startedAt),
              )}
            </span>
            <span
              className={`text-right text-meta tabular-nums ${process.cpu >= 25 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {formatPercent(process.cpu)}
            </span>
            <span className="text-right text-meta text-muted-foreground tabular-nums">
              {formatCacheSize(process.memory)}
            </span>
            <span className="text-right font-mono text-meta text-muted-foreground/70 tabular-nums">
              {process.pid}
            </span>
            <span className="flex justify-end">
              {process.stoppable ? (
                <Button
                  aria-label={`Stop ${label}`}
                  onClick={() => onStop(process)}
                  size="xs"
                  variant="ghost"
                >
                  <IconPlayerStopFilled aria-hidden="true" className="size-3" />
                  Stop
                </Button>
              ) : null}
            </span>
          </div>
        );
      })}
    </SettingsSection>
  );
}

function processRows(
  processes: readonly DiagnosticsProcess[],
  collapsed: ReadonlySet<number>,
): readonly ProcessRow[] {
  const pids = new Set(processes.map(({ pid }) => pid));
  const children = new Map<number | null, DiagnosticsProcess[]>();
  for (const process of processes) {
    const parent =
      process.parentPid !== null && pids.has(process.parentPid)
        ? process.parentPid
        : null;
    children.set(parent, [...(children.get(parent) ?? []), process]);
  }
  const rows: ProcessRow[] = [];
  const visit = (parent: number | null, depth: number) => {
    for (const process of (children.get(parent) ?? []).toSorted(
      (left, right) => left.startedAt - right.startedAt,
    )) {
      const hasChildren = children.has(process.pid);
      rows.push({ process, depth, hasChildren });
      if (hasChildren && !collapsed.has(process.pid))
        visit(process.pid, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
