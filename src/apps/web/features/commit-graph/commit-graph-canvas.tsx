import type { VirtualItem } from "@tanstack/react-virtual";
import { type JSX, useLayoutEffect, useRef } from "react";
import type { CommitLaneRow } from "#web/features/commit-graph/commit-lanes";

const lanePitch = 14;
const laneInset = 14;
const laneColors = [
  "#7c8cff",
  "#62d39a",
  "#d56c83",
  "#d0ae54",
  "#63b3d4",
  "#b07bd8",
  "#d58a5f",
  "#8dbf68",
] as const;

export function CommitGraphCanvas({
  height,
  horizontalOffset,
  laneRows,
  virtualRows,
  verticalOffset,
  width,
}: CommitGraphCanvasViewport): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    redrawCommitGraphCanvas(canvas, {
      height,
      horizontalOffset,
      laneRows,
      virtualRows,
      verticalOffset,
      width,
    });
  }, [height, horizontalOffset, laneRows, verticalOffset, virtualRows, width]);

  return (
    <canvas
      className="pointer-events-none absolute top-0 left-0"
      ref={canvasRef}
    />
  );
}

interface CommitGraphCanvasViewport {
  readonly height: number;
  readonly horizontalOffset: number;
  readonly laneRows: readonly CommitLaneRow[];
  readonly virtualRows: readonly VirtualItem[];
  readonly verticalOffset: number;
  readonly width: number;
}

export function redrawCommitGraphCanvas(
  canvas: HTMLCanvasElement,
  {
    height,
    horizontalOffset,
    laneRows,
    virtualRows,
    verticalOffset,
    width,
  }: CommitGraphCanvasViewport,
) {
  if (width <= 0 || height <= 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.ceil(width * ratio);
  const pixelHeight = Math.ceil(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = "round";
  context.lineWidth = 1.5;
  const repositoryColor = getComputedStyle(canvas)
    .getPropertyValue("--repository")
    .trim();
  context.clearRect(0, 0, width, height);

  for (const virtualRow of virtualRows) {
    const row = laneRows[virtualRow.index];
    if (row === undefined) {
      continue;
    }
    const top = virtualRow.start - verticalOffset;
    const bottom = top + virtualRow.size;
    const center = top + virtualRow.size / 2;
    const nodeIndex = row.lanesBefore.indexOf(row.nodeLaneId);
    if (nodeIndex < 0) {
      continue;
    }
    const nodeX = laneX(nodeIndex) - horizontalOffset;
    const afterPositions = new Map(
      row.lanesAfter.map((id, index) => [id, index]),
    );

    for (const [from, laneId] of row.lanesBefore.entries()) {
      const to = afterPositions.get(laneId) ?? -1;
      const fromX = laneX(from) - horizontalOffset;
      const toX = to < 0 ? nodeX : laneX(to) - horizontalOffset;
      if (Math.max(fromX, toX) < -2 || Math.min(fromX, toX) > width + 2)
        continue;
      drawLane(context, laneId, fromX, top, toX, to < 0 ? center : bottom);
    }

    for (const parentLaneId of row.parentLaneIds) {
      const parentIndex = afterPositions.get(parentLaneId) ?? -1;
      if (parentIndex < 0) {
        continue;
      }
      const parentX = laneX(parentIndex) - horizontalOffset;
      if (Math.max(parentX, nodeX) < -2 || Math.min(parentX, nodeX) > width + 2)
        continue;
      if (parentLaneId === row.nodeLaneId && parentX === nodeX) {
        continue;
      }
      drawLane(context, parentLaneId, nodeX, center, parentX, bottom);
    }

    context.fillStyle =
      laneColors[row.nodeLaneId % laneColors.length] ?? laneColors[0];
    context.beginPath();
    context.arc(nodeX, center, 4, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = repositoryColor || "#0b0b0e";
    context.lineWidth = 2;
    context.stroke();
    context.lineWidth = 1.5;
  }
}

export function commitGraphGutterWidth(laneRows: readonly CommitLaneRow[]) {
  const lanes = laneRows.reduce(
    (maximum, row) =>
      Math.max(maximum, row.lanesBefore.length, row.lanesAfter.length),
    1,
  );
  return Math.max(64, laneInset * 2 + lanes * lanePitch);
}

function laneX(index: number) {
  return laneInset + index * lanePitch;
}

export function commitGraphNodePosition(row: CommitLaneRow) {
  return laneX(row.lanesBefore.indexOf(row.nodeLaneId));
}

function drawLane(
  context: CanvasRenderingContext2D,
  laneId: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  context.strokeStyle = laneColors[laneId % laneColors.length] ?? laneColors[0];
  context.beginPath();
  context.moveTo(fromX, fromY);
  if (fromX === toX) {
    context.lineTo(toX, toY);
  } else {
    const middle = (fromY + toY) / 2;
    context.bezierCurveTo(fromX, middle, toX, middle, toX, toY);
  }
  context.stroke();
}
