import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes.contract";
import { graphRowHeight } from "#web/features/commit-graph/layout/graph-metrics";
import { graphTilePaths } from "#web/features/commit-graph/layout/graph-tile-paths";

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
  const { strokes, centers } = graphTilePaths(rows, left, width);
  for (const { path, color, opacity } of strokes.values()) {
    context.strokeStyle = color;
    context.globalAlpha = opacity;
    context.stroke(path);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  context.fill(centers);
  context.globalCompositeOperation = "source-over";
}
