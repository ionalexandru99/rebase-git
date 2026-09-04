import type { RepositoryCommit } from "@rebase/contracts";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { CommitLaneRow } from "#web/features/commit-graph/commit-lanes";
import { commitGraphNodePosition } from "#web-ui/features/commit-graph/commit-graph-canvas";

export function CommitGraphMergeControls({
  commits,
  horizontalOffset,
  laneRows,
  merges,
  onToggle,
  verticalOffset,
  virtualRows,
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly horizontalOffset: number;
  readonly laneRows: readonly CommitLaneRow[];
  readonly merges: ReadonlyMap<string, "collapsed" | "expanded">;
  readonly onToggle: (oid: string, expand: boolean) => void;
  readonly verticalOffset: number;
  readonly virtualRows: readonly VirtualItem[];
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {virtualRows.map((virtualRow) => {
        const commit = commits[virtualRow.index];
        const lane = laneRows[virtualRow.index];
        const state = commit === undefined ? undefined : merges.get(commit.oid);
        if (commit === undefined || lane === undefined || state === undefined)
          return null;
        const Icon = state === "expanded" ? IconMinus : IconPlus;
        return (
          <button
            aria-label={`${state === "expanded" ? "Collapse" : "Expand"} merge ${commit.subject}`}
            aria-expanded={state === "expanded"}
            className="pointer-events-auto absolute z-10 grid size-5 place-items-center rounded-full border border-primary bg-repository text-primary"
            key={commit.oid}
            onClick={() => onToggle(commit.oid, state !== "expanded")}
            onPointerDown={(event) => event.preventDefault()}
            style={{
              left: commitGraphNodePosition(lane) - horizontalOffset - 10,
              top: virtualRow.start - verticalOffset + virtualRow.size / 2 - 10,
            }}
            tabIndex={-1}
            type="button"
          >
            <Icon aria-hidden="true" size={12} stroke={2} />
          </button>
        );
      })}
    </div>
  );
}
