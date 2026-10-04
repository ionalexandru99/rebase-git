import type { ChangeSection } from "#contracts/repository-changes/repository-changes.contract.ts";
import { graphNodeColor } from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  commitGraphNodePosition,
  graphLaneX,
  graphRowHeight,
} from "#web/features/commit-graph/layout/graph-geometry.ts";
import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";
import { changeSectionLooks } from "#web/features/working-changes/components/change-file-section.tsx";
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
  const changes = useWorkingChanges(
    {
      repositoryId: scope?.repositoryId ?? "",
      worktreePath: scope?.worktreePath ?? "",
      amend: false,
    },
    scope !== undefined,
  ).data;
  if (
    scope === undefined ||
    changes === undefined ||
    changes.unstaged.length + changes.staged.length === 0
  )
    return undefined;
  return {
    head: changes.head,
    unstaged: new Set(changes.unstaged.map(({ path }) => path)).size,
    staged: new Set(changes.staged.map(({ path }) => path)).size,
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
      aria-rowindex={2}
      className="grid w-full items-center border-border/60 border-b bg-repository text-[.85rem] text-muted-foreground hover:bg-[color-mix(in_oklab,var(--accent)_85%,var(--repository))]"
      style={{
        gridTemplateColumns: `${x + 12}px minmax(0, 1fr)`,
        height: graphRowHeight,
      }}
    >
      <td role="gridcell" tabIndex={-1} className="relative h-full">
        <svg aria-hidden="true" className="absolute inset-0 size-full">
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
      </td>
      <td role="gridcell" tabIndex={-1} className="h-full min-w-0">
        <button
          type="button"
          aria-label={uncommittedLabel(changes)}
          onClick={onOpen}
          className="flex size-full items-center gap-2.5 pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-inset"
        >
          <span className="italic">Uncommitted changes</span>
          <SectionCount section="unstaged" count={changes.unstaged} />
          <SectionCount section="staged" count={changes.staged} />
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

function SectionCount({
  section,
  count,
}: {
  readonly section: ChangeSection;
  readonly count: number;
}) {
  if (count === 0) return null;
  const { Icon, className } = changeSectionLooks[section];
  return (
    <span className={`flex items-center gap-0.5 tabular-nums ${className}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {count}
    </span>
  );
}

function uncommittedLabel({ unstaged, staged }: UncommittedChanges) {
  return [
    "Uncommitted changes",
    ...(unstaged === 0 ? [] : [`${unstaged} unstaged`]),
    ...(staged === 0 ? [] : [`${staged} staged`]),
  ].join(", ");
}
