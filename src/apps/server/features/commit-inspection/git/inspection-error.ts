import type { ChangesFailure } from "@rebase/contracts";
import { Data } from "effect";

export class CommitInspectionError extends Data.TaggedError(
  "CommitInspectionError",
)<{ readonly failure: ChangesFailure }> {}

export function inspectionError(
  reason: ChangesFailure["reason"],
  detail: string,
) {
  return new CommitInspectionError({
    failure: { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) },
  });
}
