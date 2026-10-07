import { type CSSProperties, memo } from "react";
import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import { CommitGraphCommitCells } from "#web/features/commit-graph/components/commit-graph-commit-cells.tsx";
import {
  graphNodeColor,
  graphRemoteOpacity,
} from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  commitGraphGutterWidth,
  commitGraphNodePosition,
  graphLaneX,
  graphMetadataColumns,
  graphRowHeight,
} from "#web/features/commit-graph/layout/graph-geometry.ts";
import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";

const selectedRowStyle = {
  "--graph-row-background":
    "color-mix(in oklab, var(--primary) 28%, var(--repository))",
} as CSSProperties;

export const CommitGraphRow = memo(function CommitGraphRow({
  commit,
  labels,
  lane,
  rowIndex,
  start,
  selected,
  order,
  active,
  merge,
  busy,
  mark,
  reserve = 0,
}: {
  readonly commit: RepositoryCommit;
  readonly labels: readonly RepositoryHistoryRefTarget[];
  readonly lane: CommitLaneRow | undefined;
  readonly rowIndex: number;
  readonly start: number | undefined;
  readonly selected: boolean;
  readonly order: number;
  readonly active: boolean;
  readonly merge: "collapsed" | "expanded" | undefined;
  readonly busy: boolean;
  readonly mark?: "moving" | "base" | undefined;
  readonly reserve?: number;
}) {
  const graph = graphControls(lane, merge, commit.subject);
  return (
    <tr
      aria-label={commitAriaLabel(commit, labels)}
      aria-rowindex={rowIndex}
      aria-expanded={merge === undefined ? undefined : merge === "expanded"}
      aria-busy={busy ? true : undefined}
      aria-selected={selected}
      className={`${start === undefined ? "relative" : "absolute left-0"} grid w-full cursor-default items-center bg-[var(--graph-row-background)] text-[.85rem] text-foreground ${
        selected
          ? "after:pointer-events-none after:absolute after:inset-0 after:z-[5] after:shadow-[inset_2px_0_0_var(--primary)]"
          : "hover:[--graph-row-background:color-mix(in_oklab,var(--accent)_45%,var(--repository))] data-[active=true]:[--graph-row-background:color-mix(in_oklab,var(--accent)_85%,var(--repository))] data-[active=true]:after:pointer-events-none data-[active=true]:after:absolute data-[active=true]:after:inset-0 data-[active=true]:after:z-[5] data-[active=true]:after:shadow-[inset_2px_0_0_var(--muted-foreground)]"
      } ${lane?.nodeRemote ? "[&>td:not(:first-child)>*]:opacity-60" : ""} ${mark === undefined ? "" : `before:pointer-events-none before:absolute before:inset-0 before:z-[5] before:border-primary ${mark === "base" ? "before:border" : "before:border-l-[3px]"}`}`}
      data-active={active ? "true" : undefined}
      data-oid={commit.oid}
      id={commitRowId(commit.oid)}
      style={{
        gridTemplateColumns: `${Math.max(reserve, lane === undefined ? 28 : commitGraphGutterWidth([lane]))}px minmax(0, 1fr) ${graphMetadataColumns}`,
        height: graphRowHeight,
        top: start,
        ...(selected ? selectedRowStyle : {}),
      }}
      tabIndex={-1}
    >
      <CommitGraphCommitCells
        commit={commit}
        labels={labels}
        graph={graph}
        order={order}
      />
    </tr>
  );
});

function farEdgeButtons(lane: CommitLaneRow) {
  return [
    ...lane.lanesBefore.filter(({ far }) => far?.direction === "down"),
    ...lane.lanesAfter.filter(
      ({ far, id }) =>
        far?.direction === "up" &&
        !lane.lanesBefore.some((before) => before.id === id),
    ),
  ].flatMap(({ far, slot }) => (far === undefined ? [] : [{ end: far, slot }]));
}

export function commitRowId(oid: string) {
  return `commit-${oid}`;
}

function commitAriaLabel(
  commit: RepositoryCommit,
  labels: readonly RepositoryHistoryRefTarget[],
) {
  const parents = commit.parents.length;
  const refs =
    labels.length === 0
      ? ""
      : `, refs ${labels.map((label) => label.name).join(", ")}`;
  return `${commit.subject}, ${commit.author.name}, ${commit.oid.slice(0, 8)}, ${parents} ${parents === 1 ? "parent" : "parents"}${refs}`;
}

function CommitGraphMergeControl({
  subject,
  state,
  position,
  color,
  remote,
}: {
  readonly subject: string;
  readonly state: "collapsed" | "expanded";
  readonly position: number;
  readonly color: string;
  readonly remote: boolean;
}) {
  return (
    <button
      aria-label={`${state === "expanded" ? "Collapse" : "Expand"} merge ${subject}`}
      aria-expanded={state === "expanded"}
      className="absolute top-px z-[3] grid size-6 place-items-center"
      data-merge-toggle
      onPointerDown={(event) => event.preventDefault()}
      style={{ left: position - 12 }}
      tabIndex={-1}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-3 text-repository"
        viewBox="-6 -6 12 12"
      >
        <circle
          r="5.5"
          fill={
            remote
              ? `color-mix(in srgb, ${color} ${graphRemoteOpacity * 100}%, var(--graph-row-background, var(--repository)))`
              : color
          }
        />
        <path
          d={state === "expanded" ? "M-2.5 0h5" : "M-2.5 0h5M0-2.5v5"}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1"
        />
      </svg>
    </button>
  );
}

function graphControls(
  lane: CommitLaneRow | undefined,
  merge: "collapsed" | "expanded" | undefined,
  subject: string,
) {
  if (lane === undefined) return undefined;
  const farEdges = farEdgeButtons(lane);
  if (merge === undefined && farEdges.length === 0) return undefined;
  return (
    <>
      {merge === undefined ? null : (
        <CommitGraphMergeControl
          subject={subject}
          state={merge}
          position={commitGraphNodePosition(lane)}
          remote={lane.nodeRemote}
          color={graphNodeColor(lane)}
        />
      )}
      {farEdges.map(({ end, slot }) => (
        <button
          key={`${end.from}\0${end.direction}\0${end.to}`}
          aria-label={`Go to ${end.direction === "down" ? "parent" : "child"} ${end.to.slice(0, 8)}`}
          className="absolute z-[3] h-[13px] w-4"
          data-far-to={end.to}
          onPointerDown={(event) => event.preventDefault()}
          style={{
            left: graphLaneX(slot) - 8,
            top: end.direction === "down" ? 0 : graphRowHeight / 2,
          }}
          tabIndex={-1}
          type="button"
        />
      ))}
    </>
  );
}
