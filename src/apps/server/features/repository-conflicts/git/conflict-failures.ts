import type { ConflictFailure } from "@rebase/contracts";

export function conflictFailed(
  reason: ConflictFailure["reason"],
  detail: string,
): ConflictFailure {
  return { _tag: "ConflictFailed", reason, detail: detail.slice(0, 2048) };
}
