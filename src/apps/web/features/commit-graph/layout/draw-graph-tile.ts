import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes.contract";
import { graphLaneColor } from "#web/features/commit-graph/layout/graph-colors";
import {
  commitGraphNodePosition,
  graphLaneX,
} from "#web/features/commit-graph/layout/graph-geometry";
import { graphRowHeight } from "#web/features/commit-graph/layout/graph-metrics";

export function drawGraphTile(
  canvas: HTMLCanvasElement,
  rows: readonly CommitLaneRow[],
  left: number,
  width: number,
  ratio: number,
  colors: ReadonlyMap<number, string>,
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
  context.lineCap = "round";
  context.lineWidth = 2;
  context.clearRect(0, 0, width, height);
  for (const [index, row] of rows.entries()) {
    const top = index * graphRowHeight;
    const center = top + graphRowHeight / 2;
    const bottom = top + graphRowHeight;
    const nodeX = commitGraphNodePosition(row) - left;
    for (const lane of row.lanesBefore) {
      const x = graphLaneX(lane.slot) - left;
      if (x < -4 || x > width + 4) continue;
      drawLane(
        context,
        graphLaneColor(lane.id, colors),
        x,
        top,
        x,
        lane.id === row.nodeLaneId ? center : bottom,
      );
    }
    for (const id of row.parentLaneIds) {
      const parent = row.lanesAfter.find((lane) => lane.id === id);
      if (parent === undefined) continue;
      const parentX = graphLaneX(parent.slot) - left;
      if (Math.max(parentX, nodeX) < -4 || Math.min(parentX, nodeX) > width + 4)
        continue;
      drawLane(
        context,
        graphLaneColor(id, colors),
        nodeX,
        center,
        parentX,
        bottom,
      );
    }
    if (nodeX < -4 || nodeX > width + 4) continue;
    context.strokeStyle = graphLaneColor(row.nodeLaneId, colors);
    context.beginPath();
    context.arc(nodeX, center, 3, 0, Math.PI * 2);
    context.globalCompositeOperation = "destination-out";
    context.fill();
    context.globalCompositeOperation = "source-over";
    context.stroke();
  }
}

function drawLane(
  context: CanvasRenderingContext2D,
  color: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(fromX, fromY);
  if (fromX === toX) context.lineTo(toX, toY);
  else {
    const middle = (fromY + toY) / 2;
    context.bezierCurveTo(fromX, middle, toX, middle, toX, toY);
  }
  context.stroke();
}
