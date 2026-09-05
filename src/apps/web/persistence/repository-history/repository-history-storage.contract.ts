import { Data } from "effect";

export class RepositoryHistoryStorageUnavailable extends Data.TaggedError(
  "RepositoryHistoryStorageUnavailable",
)<{ readonly cause?: unknown }> {
  constructor(options: { readonly cause?: unknown } = {}) {
    super(options);
  }
}
