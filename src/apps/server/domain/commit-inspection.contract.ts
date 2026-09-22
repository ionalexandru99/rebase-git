import type {
  CommitInspection,
  InspectCommit,
  InspectCommitDiff,
} from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import type {
  ChangeDiff,
  ChangesFailure,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Context, Data, type Effect } from "effect";

export class CommitInspectionError extends Data.TaggedError(
  "CommitInspectionError",
)<{ readonly failure: ChangesFailure }> {}

export interface CommitInspectionService {
  readonly inspect: (
    command: InspectCommit,
  ) => Effect.Effect<CommitInspection, CommitInspectionError>;
  readonly inspectDiff: (
    command: InspectCommitDiff,
  ) => Effect.Effect<ChangeDiff, CommitInspectionError>;
}

export class CommitInspectionAccess extends Context.Service<
  CommitInspectionAccess,
  CommitInspectionService
>()("CommitInspectionAccess") {}
