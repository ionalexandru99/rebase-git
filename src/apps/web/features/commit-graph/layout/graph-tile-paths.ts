import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes.contract";
import {
  graphLaneColor,
  graphNodeColor,
  graphRemoteOpacity,
} from "#web/features/commit-graph/layout/graph-colors";
import {
  commitGraphNodePosition,
  graphLaneX,
} from "#web/features/commit-graph/layout/graph-geometry";
import { graphRowHeight } from "#web/features/commit-graph/layout/graph-metrics";

interface LaneStroke {
  readonly path: Path2D;
  readonly color: string;
  readonly opacity: number;
}

export function graphTilePaths(
  rows: readonly CommitLaneRow[],
  left: number,
  width: number,
) {
  const strokes = new Map<string, LaneStroke>();
  const centers = new Path2D();
  for (const [index, row] of rows.entries()) {
    const top = index * graphRowHeight;
    const center = top + graphRowHeight / 2;
    const bottom = top + graphRowHeight;
    const nodeX = commitGraphNodePosition(row) - left;
    const survivingLanes = new Set(row.lanesAfter.map((lane) => lane.id));
    for (const lane of row.lanesBefore) {
      if (lane.id === row.nodeLaneId && !row.nodeHasIncomingLane) continue;
      const x = graphLaneX(lane.slot) - left;
      const joinsNode =
        lane.id !== row.nodeLaneId && !survivingLanes.has(lane.id);
      const targetX = joinsNode ? nodeX : x;
      if (Math.max(x, targetX) < -4 || Math.min(x, targetX) > width + 4)
        continue;
      drawLane(
        laneStroke(
          strokes,
          graphLaneColor(lane.incomingColor ?? lane.color),
          lane.remote,
        ),
        x,
        top,
        targetX,
        lane.id === row.nodeLaneId || joinsNode ? center : bottom,
      );
    }
    for (const id of row.parentLaneIds) {
      const parent = row.lanesAfter.find((lane) => lane.id === id);
      if (parent === undefined) continue;
      const parentX = graphLaneX(parent.slot) - left;
      if (Math.max(parentX, nodeX) < -4 || Math.min(parentX, nodeX) > width + 4)
        continue;
      drawLane(
        laneStroke(
          strokes,
          graphLaneColor(parent.incomingColor ?? parent.color),
          row.nodeRemote,
        ),
        nodeX,
        center,
        parentX,
        bottom,
      );
    }
    if (nodeX < -4 || nodeX > width + 4) continue;
    const path = laneStroke(strokes, graphNodeColor(row), row.nodeRemote);
    path.moveTo(nodeX + 3, center);
    path.arc(nodeX, center, 3, 0, Math.PI * 2);
    centers.moveTo(nodeX + 2, center);
    centers.arc(nodeX, center, 2, 0, Math.PI * 2);
  }
  return { strokes, centers };
}

function laneStroke(
  strokes: Map<string, LaneStroke>,
  color: string,
  remote: boolean,
) {
  const key = `${color}:${remote}`;
  let stroke = strokes.get(key);
  if (stroke === undefined) {
    stroke = {
      path: new Path2D(),
      color,
      opacity: remote ? graphRemoteOpacity : 1,
    };
    strokes.set(key, stroke);
  }
  return stroke.path;
}

function drawLane(
  path: Path2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  path.moveTo(fromX, fromY);
  if (fromX === toX) path.lineTo(toX, toY);
  else {
    const middle = (fromY + toY) / 2;
    path.bezierCurveTo(fromX, middle, toX, middle, toX, toY);
  }
}
