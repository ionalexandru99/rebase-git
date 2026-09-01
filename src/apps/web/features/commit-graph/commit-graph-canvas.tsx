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
}: {
  readonly height: number;
  readonly horizontalOffset: number;
  readonly laneRows: readonly CommitLaneRow[];
  readonly virtualRows: readonly VirtualItem[];
  readonly verticalOffset: number;
  readonly width: number;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || width <= 0 || height <= 0) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    context.scale(ratio, ratio);
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

      for (const laneId of row.lanesBefore) {
        const from = row.lanesBefore.indexOf(laneId);
        const to = row.lanesAfter.indexOf(laneId);
        const fromX = laneX(from) - horizontalOffset;
        drawLane(
          context,
          laneId,
          fromX,
          top,
          to < 0 ? nodeX : laneX(to) - horizontalOffset,
          to < 0 ? center : bottom,
        );
      }

      for (const parentLaneId of row.parentLaneIds) {
        const parentIndex = row.lanesAfter.indexOf(parentLaneId);
        if (parentIndex < 0) {
          continue;
        }
        const parentX = laneX(parentIndex) - horizontalOffset;
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
  }, [height, horizontalOffset, laneRows, verticalOffset, virtualRows, width]);

  return (
    <canvas
      className="pointer-events-none absolute top-0 left-0"
      ref={canvasRef}
    />
  );
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
