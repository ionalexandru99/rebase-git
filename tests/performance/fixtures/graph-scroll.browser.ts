import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommitGraph } from "#web/features/commit-graph/index";
import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";

let root: Root | undefined;

export function mountGraph(laneCount: number) {
  root?.unmount();
  const container = document.createElement("div");
  container.style.cssText =
    "height:100vh;width:100vw;background:var(--repository)";
  document.body.replaceChildren(container);
  document.documentElement.classList.add("dark");
  const count = 100_000;
  const oid = (index: number) => index.toString(16).padStart(40, "0");
  const commit = (index: number): RepositoryCommit => {
    const identity = {
      name:
        ["Alexandru Ion", "Maria Popescu", "Sam Chen"][index % 3] ??
        "Alexandru Ion",
      email: `author${index % 3}@example.test`,
      timestampSeconds: 1_788_566_400 - index * 60,
      timezoneOffsetMinutes: 0,
    };
    return {
      oid: oid(index),
      subject:
        [
          "Keep graph and commit text aligned while scrolling",
          "Preserve merge expansion in Auto mode",
          "Cache GitHub avatars in the background",
        ][index % 3] ?? "Commit",
      author: identity,
      committer: identity,
      parents: index + laneCount < count ? [oid(index + laneCount)] : [],
    };
  };
  const roots: RepositoryHistoryRefTarget[] = Array.from(
    { length: laneCount },
    (_, index) => ({
      oid: oid(index),
      type: "branch",
      name: index === 0 ? "main" : `feature/branch-${index}`,
    }),
  );
  const snapshot = {
    revision: 0,
    historyRevision: 0,
    status: "ready",
    synchronization: "complete",
    synchronizedCommitCount: count,
  } as const;
  const reader: RepositoryHistoryReader = {
    read: async (query) =>
      Array.from(
        {
          length: Math.min(
            query.limit,
            Math.max(0, count - (query.offset ?? 0)),
          ),
        },
        (_, index) => commit(index + (query.offset ?? 0)),
      ),
    getSnapshot: () => snapshot,
    getRefTargets: async () => [
      ...roots,
      { oid: oid(laneCount), name: "origin/main", type: "remote-branch" },
      { oid: oid(2), name: "v0.0.2", type: "tag" },
    ],
    getCommitSummaries: async (oids) =>
      oids.map((value) => commit(Number.parseInt(value, 16))),
    locate: async (_query, value) => Number.parseInt(value, 16),
    locateMany: async (_query, oids) =>
      oids.map((value) => ({ oid: value, index: Number.parseInt(value, 16) })),
    ancestryRoute: async () => undefined,
    subscribe: () => () => {},
    close: () => {},
    fetch: async () => {
      throw new Error("No fetch in scroll fixture");
    },
    configureFetch: async () => {
      throw new Error("No fetch in scroll fixture");
    },
    getCacheDiagnostics: async () => ({ caches: [], persistent: false }),
    manageCache: async () => undefined,
    search: async () => ({
      commits: [],
      replicaComplete: true,
      synchronizedCommitCount: count,
    }),
  };
  root = createRoot(container);
  root.render(
    createElement(CommitGraph, {
      reader,
      roots,
      repositoryName: "100,000 commits",
      scope: { _tag: "Automatic" },
    }),
  );
}

export async function measureGraphScroll(laneCount: number) {
  const grid = document.querySelector<HTMLTableElement>('table[role="grid"]');
  if (grid === null) throw new Error("Missing graph grid");
  let maximumMismatch = 0;
  let maximumBytes = 0;
  let maximumRows = 0;
  let maximumTiles = 0;
  let paintedSamples = 0;
  let draws = 0;
  const original = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    draws += 1;
    return original.apply(this, args);
  };
  const frames: number[] = [];
  let previous = performance.now();
  try {
    for (let frame = 0; frame < 160; frame += 1) {
      grid.scrollTop += 13;
      grid.scrollLeft =
        frame % 2 === 0 ? Math.min(grid.scrollWidth - grid.clientWidth, 11) : 0;
      const bounds = grid.getBoundingClientRect();
      const rows = [
        ...grid.querySelectorAll<HTMLTableRowElement>("tr[aria-rowindex]"),
      ];
      const row = rows.find(
        (candidate) => candidate.getBoundingClientRect().top >= bounds.top + 28,
      );
      const canvases = [...grid.querySelectorAll("canvas")];
      maximumRows = Math.max(maximumRows, rows.length);
      maximumTiles = Math.max(maximumTiles, canvases.length);
      maximumBytes = Math.max(
        maximumBytes,
        canvases.reduce(
          (sum, canvas) => sum + canvas.width * canvas.height * 4,
          0,
        ),
      );
      if (row === undefined) throw new Error("Missing visible row");
      const index = Number(row.getAttribute("aria-rowindex")) - 2;
      const node = { x: 16 + (index % laneCount) * 16, y: index * 26 + 13 };
      const canvas = canvases.find((candidate) => {
        const tile = candidate.closest("tr");
        return (
          tile !== null &&
          node.y >= tile.offsetTop &&
          node.y < tile.offsetTop + tile.offsetHeight &&
          node.x >= tile.offsetLeft &&
          node.x < tile.offsetLeft + tile.offsetWidth
        );
      });
      if (canvas === undefined) throw new Error("Missing visible graph tile");
      const tile = canvas.closest("tr");
      if (tile === null) throw new Error("Missing canvas row");
      const actualY =
        canvas.getBoundingClientRect().top + node.y - tile.offsetTop;
      maximumMismatch = Math.max(
        maximumMismatch,
        Math.abs(actualY - row.getBoundingClientRect().top - 13),
      );
      const ratio = canvas.width / Number.parseFloat(canvas.style.width);
      const pixel = canvas
        .getContext("2d")
        ?.getImageData(
          Math.round((node.x - tile.offsetLeft + 3) * ratio),
          Math.round((node.y - tile.offsetTop) * ratio),
          1,
          1,
        ).data;
      if ((pixel?.[3] ?? 0) > 0) paintedSamples += 1;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
    }
    return {
      laneCount,
      maximumMismatch,
      maximumBytes,
      maximumRows,
      maximumTiles,
      paintedSamples,
      draws,
      p95FrameMilliseconds: frames.toSorted((a, b) => a - b)[151] ?? 0,
    };
  } finally {
    CanvasRenderingContext2D.prototype.clearRect = original;
  }
}
