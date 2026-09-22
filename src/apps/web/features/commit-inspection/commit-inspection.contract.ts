import type {
  CommitInspection,
  InspectCommit,
  InspectCommitDiff,
} from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import type { ChangeDiff } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Data, type Effect } from "effect";
import type { DiffPreferences } from "#web/features/file-diff/file-diff.contract";

export class CommitInspectionError extends Data.TaggedError(
  "CommitInspectionError",
)<{ readonly message: string }> {}
export interface CommitInspectionClient {
  readonly inspect: (
    command: InspectCommit,
  ) => Effect.Effect<CommitInspection, CommitInspectionError>;
  readonly diff: (
    command: InspectCommitDiff,
  ) => Effect.Effect<ChangeDiff, CommitInspectionError>;
}

export interface CommitInspectionState {
  readonly oid: string | undefined;
  readonly details: CommitInspection | null;
  readonly path: string | null;
  readonly diff: ChangeDiff | null;
  readonly loading: boolean;
  readonly loadingDiff: boolean;
  readonly error: string | null;
  readonly diffError: string | null;
  readonly preferences: DiffPreferences;
}
