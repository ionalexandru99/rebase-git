import { Data } from "effect";

export class WorkingChangesStoreUnavailable extends Data.TaggedError(
  "WorkingChangesStoreUnavailable",
)<{ readonly message: string }> {}
