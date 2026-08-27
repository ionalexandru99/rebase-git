import type { Effect } from "effect";

export interface RepositoryWatchHandle {
  readonly close: () => void;
}

export interface RepositoryWatcher {
  readonly watch: (
    gitDirectory: string,
    onChange: () => void,
  ) => Effect.Effect<RepositoryWatchHandle>;
}
