import { createHash } from "node:crypto";
import type { RepositoryHistorySnapshot } from "@rebase/contracts";

export const historyTraversalPageSize = 5_000;
const traversalVersion = `sorted-frontier-${historyTraversalPageSize}-v1`;

export function historyTraversalIdentity(
  objectFormat: "sha1" | "sha256",
  rootOids: readonly string[],
  shallowOids: readonly string[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify([traversalVersion, objectFormat, rootOids, shallowOids]),
    )
    .digest("hex")
    .slice(0, 32);
}

export function historySnapshotIdentity(
  objectFormat: "sha1" | "sha256",
  refs: RepositoryHistorySnapshot["refTargets"],
  rootOids: readonly string[],
  shallowOids: readonly string[],
) {
  const traversal = historyTraversalIdentity(
    objectFormat,
    rootOids,
    shallowOids,
  );
  const refMap = createHash("sha256")
    .update(JSON.stringify(refs))
    .digest("hex")
    .slice(0, 32);
  return traversal + refMap;
}
