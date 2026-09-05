import type { RepositoryFreshness } from "@rebase/contracts";

export interface FreshnessSubscription {
  readonly path: string;
  readonly publish: (freshness: RepositoryFreshness) => void;
  readonly automaticFetch: boolean;
}
