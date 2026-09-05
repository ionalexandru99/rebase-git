import type { VirtualItem } from "@tanstack/react-virtual";
import {
  memo,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes";
import { drawGraphTile } from "#web/features/commit-graph/layout/draw-graph-tile";
import { commitGraphGutterWidth } from "#web/features/commit-graph/layout/graph-geometry";
import { graphRowHeight } from "#web/features/commit-graph/layout/graph-metrics";

const tileRows = 32;

export function CommitGraphCanvas({
  laneRows,
  virtualRows,
  colors,
  scrollRef,
  viewportWidth,
}: {
  readonly laneRows: readonly CommitLaneRow[];
  readonly virtualRows: readonly VirtualItem[];
  readonly colors: ReadonlyMap<number, string>;
  readonly scrollRef: RefObject<HTMLTableElement | null>;
  readonly viewportWidth: number;
}) {
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const scroll = () =>
      setLeft(Math.max(0, Math.floor(element.scrollLeft / 256) * 256 - 256));
    scroll();
    element.addEventListener("scroll", scroll, { passive: true });
    return () => element.removeEventListener("scroll", scroll);
  }, [scrollRef]);
  const offset =
    virtualRows[0] === undefined
      ? 0
      : virtualRows[0].start / graphRowHeight - virtualRows[0].index;
  const tiles = new Set(
    virtualRows.map((row) => Math.floor((row.index + offset) / tileRows)),
  );
  const graphWidth = useMemo(
    () => commitGraphGutterWidth(laneRows),
    [laneRows],
  );
  const maximumWidth = Math.min(graphWidth, viewportWidth + 768);
  const maximumRatio = Math.min(
    2,
    Math.sqrt(
      (63 * 1_048_576) /
        Math.max(1, tiles.size * maximumWidth * tileRows * graphRowHeight * 4),
    ),
  );
  return [...tiles].map((tile) => (
    <GraphTile
      key={tile}
      tile={tile}
      offset={offset}
      laneRows={laneRows}
      colors={colors}
      left={left}
      maximumWidth={maximumWidth}
      maximumRatio={maximumRatio}
    />
  ));
}

const GraphTile = memo(function GraphTile({
  tile,
  offset,
  laneRows,
  colors,
  left,
  maximumWidth,
  maximumRatio,
}: {
  readonly tile: number;
  readonly offset: number;
  readonly laneRows: readonly CommitLaneRow[];
  readonly colors: ReadonlyMap<number, string>;
  readonly left: number;
  readonly maximumWidth: number;
  readonly maximumRatio: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  const start = Math.max(0, tile * tileRows - offset);
  const end = Math.min(laneRows.length, (tile + 1) * tileRows - offset);
  const rows = useMemo(
    () => laneRows.slice(start, end),
    [laneRows, start, end],
  );
  const width = Math.max(
    0,
    Math.min(commitGraphGutterWidth(rows) - left, maximumWidth),
  );
  const height = rows.length * graphRowHeight;
  useLayoutEffect(() => {
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const refresh = () => setRatio(window.devicePixelRatio || 1);
    query.addEventListener("change", refresh);
    return () => query.removeEventListener("change", refresh);
  }, [ratio]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    drawGraphTile(
      canvas,
      rows,
      left,
      width,
      Math.min(ratio, maximumRatio),
      colors,
    );
  }, [rows, width, colors, ratio, left, maximumRatio]);

  return (
    <tr
      inert
      className="pointer-events-none absolute z-[1] block overflow-hidden"
      style={{ top: (offset + start) * graphRowHeight, left, width, height }}
    >
      <td className="block p-0">
        <canvas ref={canvasRef} />
      </td>
    </tr>
  );
});
