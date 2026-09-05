import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";
import { assertTimingBudget } from "#tests-performance/timing-budget";

test("256 active lanes stay within append and canvas budgets", async ({
  page,
}) => {
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(url);
    const metrics = await page.evaluate(async () => {
      const lanesPath = "/features/commit-graph/layout/commit-lanes.ts";
      const {
        appendCommitLanes,
        createCommitLaneCheckpoint,
      }: typeof import("#web/features/commit-graph/layout/commit-lanes") =
        await import(lanesPath);
      const canvasPath =
        "/features/commit-graph/components/commit-graph-canvas.tsx";
      const {
        redrawCommitGraphCanvas,
      }: typeof import("#web-ui/features/commit-graph/components/commit-graph-canvas") =
        await import(canvasPath);
      const branches = 256;
      const depth = 8;
      const oid = (index: number) => index.toString(16).padStart(40, "0");
      const base = oid(branches * depth + 1);
      const commits = [
        {
          oid: oid(0),
          parents: Array.from({ length: branches }, (_, index) =>
            oid(index + 1),
          ),
        },
        ...Array.from({ length: branches * depth }, (_, index) => ({
          oid: oid(index + 1),
          parents: [
            index + branches < branches * depth
              ? oid(index + branches + 1)
              : base,
          ],
        })),
        { oid: base, parents: [] },
      ];
      let checkpoint = createCommitLaneCheckpoint();
      const rows: import("#web/features/commit-graph/layout/commit-lanes").CommitLaneRow[] =
        [];
      const appendDurations: number[] = [];
      let firstPlans = "";
      for (let offset = 0; offset < commits.length; offset += 64) {
        const started = performance.now();
        const appended = appendCommitLanes(
          checkpoint,
          commits.slice(offset, offset + 64),
        );
        appendDurations.push(performance.now() - started);
        checkpoint = appended.checkpoint;
        rows.push(...appended.rows);
        if (offset === 0) firstPlans = JSON.stringify(rows);
      }
      if (JSON.stringify(rows.slice(0, 64)) !== firstPlans)
        throw new Error("Appending changed prior lane plans");
      const canvas = document.createElement("canvas");
      document.body.replaceChildren(canvas);
      const redrawDurations: number[] = [];
      for (let frame = 0; frame < 130; frame += 1) {
        await new Promise(requestAnimationFrame);
        const first = 1 + frame * 5;
        const virtualRows = Array.from({ length: 36 }, (_, offset) => ({
          index: first + offset,
          start: (first + offset) * 36,
          end: (first + offset + 1) * 36,
          size: 36,
          lane: 0,
          key: first + offset,
        }));
        const started = performance.now();
        redrawCommitGraphCanvas(canvas, {
          height: 900,
          width: 1024,
          laneRows: rows,
          virtualRows,
          horizontalOffset: frame % 2 === 0 ? 0 : 2048,
          verticalOffset: first * 36,
        });
        if (frame >= 10) redrawDurations.push(performance.now() - started);
      }
      return {
        appendDurations,
        redrawDurations,
        maxLanes: Math.max(...rows.map((row) => row.lanesAfter.length)),
      };
    });
    const sorted = metrics.redrawDurations.toSorted((a, b) => a - b);
    const redrawP95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity;
    const maxAppend = Math.max(...metrics.appendDurations);
    process.stdout.write(
      `${JSON.stringify({ maxLanes: metrics.maxLanes, redrawP95, maxAppend })}\n`,
    );
    expect(metrics.maxLanes).toBeGreaterThanOrEqual(256);
    assertTimingBudget("Merge topology append maximum", maxAppend, 50);
    assertTimingBudget("Merge topology canvas redraw p95", redrawP95, 2);
  } finally {
    await server.close();
  }
});
