import type { RepositoryCommit } from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";
import type {
  RepositoryHistorySearchQuery,
  RepositoryHistorySearchResult,
} from "#web/features/repository-history/search/repository-history-search.contract";

export class RepositoryHistorySearchFailure extends Data.TaggedError(
  "RepositoryHistorySearchFailure",
)<{ readonly operation: "search" | "navigate"; readonly cause: unknown }> {}

export interface RepositoryHistorySearchSnapshot {
  readonly text: string;
  readonly commits: readonly RepositoryCommit[];
  readonly cursor: string | undefined;
  readonly error: RepositoryHistorySearchFailure | undefined;
  readonly complete: boolean;
  readonly count: number;
  readonly loading: boolean;
  readonly navigating: boolean;
  readonly selected: number;
}

export interface RepositoryHistorySearchModel {
  readonly getSnapshot: () => RepositoryHistorySearchSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setText: (text: string) => void;
  readonly retry: () => void;
  readonly loadMore: () => void;
  readonly navigate: (index: number) => void;
  readonly next: () => void;
  readonly previous: () => void;
}

export class RepositoryHistorySearchSource extends Context.Service<
  RepositoryHistorySearchSource,
  {
    readonly search: (
      query: RepositoryHistorySearchQuery,
    ) => Effect.Effect<
      RepositoryHistorySearchResult,
      RepositoryHistorySearchFailure
    >;
    readonly navigate: (
      oid: string,
    ) => Effect.Effect<void, RepositoryHistorySearchFailure>;
  }
>()("rebase/RepositoryHistorySearchSource") {}
