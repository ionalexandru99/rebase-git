import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";

export const automaticHistoryScope = { _tag: "Automatic" } as const;

export type HistoryScope =
  | typeof automaticHistoryScope
  | {
      readonly _tag: "Custom";
      readonly selections: readonly RepositoryRefTarget[];
    };

export interface ResolvedHistoryScope {
  readonly roots: readonly RepositoryHistoryRefTarget[];
  readonly scope: HistoryScope;
  readonly selectedRefKeys: ReadonlySet<string>;
  readonly selections: readonly RepositoryRefTarget[];
}
