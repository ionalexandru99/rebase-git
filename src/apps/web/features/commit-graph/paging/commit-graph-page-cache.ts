import type { CommitLaneCheckpoint } from "#web/features/commit-graph/commit-lanes";
import type { CommitGraphPage } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import { estimateCheckpoint } from "#web/features/commit-graph/paging/prepare-commit-graph-page";

export interface CommitGraphPageCache {
  readonly pages: Map<number, CommitGraphPage>;
  readonly checkpoints: Map<number, CommitLaneCheckpoint>;
}

export function estimateGraphPageCache(cache: CommitGraphPageCache) {
  const checkpoints = new Set(cache.checkpoints.values());
  let bytes = 0;
  for (const page of cache.pages.values()) {
    bytes += page.estimatedBytes;
    checkpoints.add(page.incomingCheckpoint);
    checkpoints.add(page.outgoingCheckpoint);
  }
  for (const checkpoint of checkpoints) bytes += estimateCheckpoint(checkpoint);
  return bytes;
}

export function retainGraphPage(
  cache: CommitGraphPageCache,
  page: CommitGraphPage,
  pageSize: number,
  maximumPages: number,
  maximumBytes: number,
) {
  if (
    page.estimatedBytes +
      estimateCheckpoint(page.incomingCheckpoint) +
      estimateCheckpoint(page.outgoingCheckpoint) >
    maximumBytes
  )
    throw new Error("This history page exceeds the graph cache budget.");
  const offsets = [...cache.pages.keys()];
  if (
    offsets.length > 0 &&
    !offsets.some((offset) => Math.abs(offset - page.offset) <= pageSize)
  )
    cache.pages.clear();
  cache.pages.set(page.offset, page);
  cache.checkpoints.set(page.offset, page.incomingCheckpoint);
  cache.checkpoints.set(
    page.offset + page.commits.length,
    page.outgoingCheckpoint,
  );
  while (
    cache.pages.size > maximumPages ||
    estimateGraphPageCache(cache) > maximumBytes
  ) {
    if (cache.pages.size <= 1) break;
    const farthest = [...cache.pages.keys()]
      .filter((offset) => offset !== page.offset)
      .sort(
        (left, right) =>
          Math.abs(right - page.offset) - Math.abs(left - page.offset),
      )[0];
    if (farthest === undefined) break;
    cache.pages.delete(farthest);
  }
  const protectedOffsets = new Set(
    [...cache.pages.values()].flatMap((retained) => [
      retained.offset,
      retained.offset + retained.commits.length,
    ]),
  );
  for (const offset of [...cache.checkpoints.keys()].sort(
    (left, right) =>
      Math.abs(right - page.offset) - Math.abs(left - page.offset),
  )) {
    if (estimateGraphPageCache(cache) <= maximumBytes) break;
    if (!protectedOffsets.has(offset)) cache.checkpoints.delete(offset);
  }
}
