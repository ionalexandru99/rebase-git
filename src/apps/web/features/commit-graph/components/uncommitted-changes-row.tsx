import { graphNodeColor } from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  commitGraphNodePosition,
  graphLaneX,
  graphRowHeight,
} from "#web/features/commit-graph/layout/graph-geometry.ts";
import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";
import { ChangeCount } from "#web/features/working-changes/components/change-file-section.tsx";
import { splitConflicts } from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import { useWorkingChanges } from "#web/features/working-changes/hooks/use-working-changes.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export interface UncommittedChanges {
  readonly head: string | null;
  readonly unstaged: number;
  readonly staged: number;
}

export interface UncommittedLink {
  readonly index: number;
  readonly x: number;
  readonly color: string;
}

const nodeRadius = 4.5;
const nodeGap = 2;

export function useUncommittedChanges(): UncommittedChanges | undefined {
  const scope = useRepositoryScope();
  const read = useWorkingChanges(
    {
      repositoryId: scope?.repositoryId ?? "",
      worktreePath: scope?.worktreePath ?? "",
      amend: false,
    },
    scope !== undefined,
  );
  const { changes, conflicted } = splitConflicts(read.data);
  if (
    scope === undefined ||
    read.isPlaceholderData ||
    changes === undefined ||
    changes.unstaged.length + changes.staged.length + conflicted.length === 0
  )
    return undefined;
  return {
    head: changes.head,
    unstaged: changes.unstaged.length,
    staged: changes.staged.length,
  };
}

export function uncommittedLink(
  lanes: readonly CommitLaneRow[],
  start: number,
  head: string | null,
): UncommittedLink | undefined {
  if (start !== 0) return undefined;
  const index = lanes.findIndex((row) => row.oid === head);
  const row = lanes[index];
  if (row === undefined || row.nodeHasIncomingLane) return undefined;
  const slot = row.lanesBefore.find((lane) => lane.id === row.nodeLaneId)?.slot;
  const crossed = lanes
    .slice(0, index)
    .some((above) =>
      [...above.lanesBefore, ...above.lanesAfter].some(
        (lane) => lane.slot === slot,
      ),
    );
  return crossed
    ? undefined
    : { index, x: commitGraphNodePosition(row), color: graphNodeColor(row) };
}

export function UncommittedChangesRow({
  changes,
  link,
  onOpen,
}: {
  readonly changes: UncommittedChanges;
  readonly link: UncommittedLink | undefined;
  readonly onOpen: (() => void) | undefined;
}) {
  const x = link?.x ?? graphLaneX(0);
  const color = link?.color ?? "var(--muted-foreground)";
  const center = graphRowHeight / 2;
  return (
    <tr
      className="block border-border/60 border-b bg-repository"
      style={{ height: graphRowHeight }}
    >
      <td role="gridcell" tabIndex={-1} colSpan={5} className="block h-full">
        <button
          type="button"
          aria-label={uncommittedLabel(changes)}
          onClick={onOpen}
          className="grid size-full items-center text-left text-[.85rem] text-muted-foreground outline-none hover:bg-[color-mix(in_oklab,var(--accent)_85%,var(--repository))] focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-inset"
          style={{ gridTemplateColumns: `${x + 12}px minmax(0, 1fr)` }}
        >
          <svg aria-hidden="true" className="size-full">
            {link === undefined ? null : (
              <line
                x1={x}
                x2={x}
                y1={center + nodeRadius + nodeGap / 2}
                y2={graphRowHeight}
                stroke={color}
                strokeDasharray="3 2.5"
                strokeWidth="2"
              />
            )}
            <circle
              cx={x}
              cy={center}
              r={nodeRadius}
              fill="var(--repository)"
              stroke={color}
              strokeDasharray="2.6 1.8"
              strokeWidth="1.5"
            />
          </svg>
          <span className="flex min-w-0 items-center gap-2.5 pl-1">
            <span className="rounded-[5px] border border-muted-foreground/70 border-dashed px-1.5 py-0.5 text-foreground leading-none">
              Uncommitted changes
            </span>
            <ChangeCount section="unstaged" count={changes.unstaged} />
            <ChangeCount section="staged" count={changes.staged} />
          </span>
        </button>
      </td>
    </tr>
  );
}

export function UncommittedChangesLine({
  link,
}: {
  readonly link: UncommittedLink;
}) {
  return (
    <tr
      inert
      className="pointer-events-none absolute top-0 z-[2] block w-0.5"
      style={{
        left: link.x - 1,
        height:
          link.index * graphRowHeight +
          graphRowHeight / 2 -
          nodeRadius -
          nodeGap,
        backgroundImage: `repeating-linear-gradient(${link.color} 0 3px, transparent 3px 5.5px)`,
      }}
    />
  );
}

function uncommittedLabel({ unstaged, staged }: UncommittedChanges) {
  return [
    "Uncommitted changes",
    ...(unstaged === 0 ? [] : [`${unstaged} unstaged`]),
    ...(staged === 0 ? [] : [`${staged} staged`]),
  ].join(", ");
}
