import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { Effect } from "effect";
import type { RepositoryFreshnessService } from "#server/domain/repository-freshness.contract";
import type { RepositoryHistoryService } from "#server/domain/repository-history.contract";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";

export interface EnvironmentTransportState {
  readonly discovery: EnvironmentDiscovery;
  readonly events: EnvironmentEventPublisher;
  readonly history?: RepositoryHistoryService;
  readonly freshness?: RepositoryFreshnessService;
}

export type RunEnvironmentEffect = (
  effect: Effect.Effect<void, never, never>,
  signal?: AbortSignal,
) => void;
