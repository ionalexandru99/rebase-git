import type { ChangesFailure } from "@rebase/contracts";
import { CommitInspectionError } from "#server/domain/commit-inspection.contract";

export function inspectionError(
  reason: ChangesFailure["reason"],
  detail: string,
) {
  return new CommitInspectionError({
    failure: { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) },
  });
}
