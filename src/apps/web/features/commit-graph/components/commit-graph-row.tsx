import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import { type CSSProperties, memo, useMemo } from "react";
import { CommitGraphCommitCells } from "#web/features/commit-graph/components/commit-graph-commit-cells";
import { CommitGraphMergeControl } from "#web/features/commit-graph/components/commit-graph-merge-controls";
import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes";
import { graphNodeColor } from "#web/features/commit-graph/layout/graph-colors";
import {
  commitGraphGutterWidth,
  commitGraphNodePosition,
} from "#web/features/commit-graph/layout/graph-geometry";
import { graphMetadataColumns } from "#web/features/commit-graph/layout/graph-metrics";

const selectedRowStyle = {
  "--graph-row-background":
    "color-mix(in oklab, var(--primary) 12%, var(--repository))",
} as CSSProperties;

export const CommitGraphRow = memo(function CommitGraphRow({
  commit,
  labels,
  lane,
  rowIndex,
  size,
  start,
  selected,
  active,
  merge,
  busy,
}: {
  readonly commit: RepositoryCommit;
  readonly labels: readonly RepositoryHistoryRefTarget[];
  readonly lane: CommitLaneRow | undefined;
  readonly rowIndex: number;
  readonly size: number;
  readonly start: number;
  readonly selected: boolean;
  readonly active: boolean;
  readonly merge: "collapsed" | "expanded" | undefined;
  readonly busy: boolean;
}) {
  const graph = useMemo(
    () =>
      lane === undefined || merge === undefined ? undefined : (
        <CommitGraphMergeControl
          subject={commit.subject}
          state={merge}
          position={commitGraphNodePosition(lane)}
          remote={lane.nodeRemote}
          color={graphNodeColor(lane)}
        />
      ),
    [commit.subject, lane, merge],
  );
  return (
    <tr
      aria-label={commitAriaLabel(commit, labels)}
      aria-rowindex={rowIndex}
      aria-expanded={merge === undefined ? undefined : merge === "expanded"}
      aria-busy={busy ? true : undefined}
      aria-selected={selected}
      className={`absolute left-0 grid w-full cursor-default items-center bg-[var(--graph-row-background)] text-[.85rem] after:pointer-events-none after:absolute after:inset-0 after:z-[5] data-[active=true]:after:border data-[active=true]:after:border-primary/70 ${
        selected
          ? "text-foreground"
          : "text-foreground hover:[--graph-row-background:color-mix(in_oklab,var(--accent)_35%,var(--repository))]"
      }`}
      data-active={active ? "true" : undefined}
      data-oid={commit.oid}
      id={commitRowId(commit.oid)}
      style={{
        gridTemplateColumns: `${lane === undefined ? 28 : commitGraphGutterWidth([lane])}px minmax(0, 1fr) ${graphMetadataColumns}`,
        height: size,
        top: start,
        ...(selected ? selectedRowStyle : {}),
      }}
      tabIndex={-1}
    >
      <CommitGraphCommitCells commit={commit} labels={labels} graph={graph} />
    </tr>
  );
});

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
