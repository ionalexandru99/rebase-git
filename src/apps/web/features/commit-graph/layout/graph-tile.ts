import {
  graphLaneColor,
  graphNodeColor,
  graphRemoteOpacity,
} from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  commitGraphNodePosition,
  graphLaneX,
  graphRowHeight,
} from "#web/features/commit-graph/layout/graph-geometry.ts";
import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";

interface LaneStroke {
  readonly path: Path2D;
  readonly color: string;
  readonly opacity: number;
}

function graphTilePaths(
  rows: readonly CommitLaneRow[],
  left: number,
  width: number,
) {
  const strokes = new Map<string, LaneStroke>();
  const centers = new Path2D();
  const dots = new Map<string, Path2D>();
  for (const [index, row] of rows.entries()) {
    const top = index * graphRowHeight;
    const center = top + graphRowHeight / 2;
    const bottom = top + graphRowHeight;
    const nodeX = commitGraphNodePosition(row) - left;
    const survivingLanes = new Set(row.lanesAfter.map((lane) => lane.id));
    for (const lane of row.lanesBefore) {
      if (lane.id === row.nodeLaneId && !row.nodeHasIncomingLane) continue;
      const x = graphLaneX(lane.slot) - left;
      if (lane.far?.direction === "down") {
        drawFarArrow(
          laneStroke(strokes, graphLaneColor(lane.color), lane.remote),
          x,
          top,
          center + 2,
        );
        continue;
      }
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
    for (const lane of row.lanesAfter) {
      if (
        lane.far?.direction !== "up" ||
        row.lanesBefore.some((before) => before.id === lane.id)
      )
        continue;
      drawFarArrow(
        laneStroke(strokes, graphLaneColor(lane.color), lane.remote),
        graphLaneX(lane.slot) - left,
        bottom,
        center - 2,
      );
    }
    if (nodeX < -4 || nodeX > width + 4) continue;
    if (!row.nodeRemote) {
      const color = graphNodeColor(row);
      const dot = dots.get(color) ?? new Path2D();
      dots.set(color, dot);
      dot.moveTo(nodeX + 4, center);
      dot.arc(nodeX, center, 4, 0, Math.PI * 2);
      continue;
    }
    const path = laneStroke(strokes, graphNodeColor(row), true);
    path.moveTo(nodeX + 3, center);
    path.arc(nodeX, center, 3, 0, Math.PI * 2);
    centers.moveTo(nodeX + 2, center);
    centers.arc(nodeX, center, 2, 0, Math.PI * 2);
  }
  return { strokes, centers, dots };
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

function drawFarArrow(path: Path2D, x: number, fromY: number, tipY: number) {
  const wing = tipY > fromY ? -3.5 : 3.5;
  path.moveTo(x, fromY);
  path.lineTo(x, tipY);
  path.moveTo(x - 3.5, tipY + wing);
  path.lineTo(x, tipY);
  path.lineTo(x + 3.5, tipY + wing);
}

export function drawGraphTile(
  canvas: HTMLCanvasElement,
  rows: readonly CommitLaneRow[],
  left: number,
  width: number,
  ratio: number,
) {
  const height = rows.length * graphRowHeight;
  if (width <= 0 || height <= 0) {
    canvas.width = 0;
    canvas.height = 0;
    return;
  }
  const pixelWidth = Math.ceil(width * ratio);
  const pixelHeight = Math.ceil(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = "butt";
  context.lineWidth = 2;
  context.clearRect(0, 0, width, height);
  const { strokes, centers, dots } = graphTilePaths(rows, left, width);
  for (const { path, color, opacity } of strokes.values()) {
    context.strokeStyle = color;
    context.globalAlpha = opacity;
    context.stroke(path);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  context.fill(centers);
  context.globalCompositeOperation = "source-over";
  for (const [color, dot] of dots) {
    context.fillStyle = color;
    context.fill(dot);
  }
}
