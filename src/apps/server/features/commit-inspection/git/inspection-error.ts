import type { ChangesFailure } from "@rebase/contracts";

export function inspectionError(
  reason: ChangesFailure["reason"],
  detail: string,
): ChangesFailure {
  return { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) };
}
