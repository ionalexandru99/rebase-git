import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { Effect } from "effect";
import type { RepositoryChangesService } from "#server/domain/repository-changes.contract";
import type { RepositoryFreshnessService } from "#server/domain/repository-freshness.contract";
import type { RepositoryHistoryService } from "#server/domain/repository-history.contract";
import type { RepositoryOperationsService } from "#server/domain/repository-operations.contract";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";

export interface EnvironmentTransportState {
  readonly operations?: RepositoryOperationsService;
  readonly changes?: RepositoryChangesService;
  readonly discovery: EnvironmentDiscovery;
  readonly events: EnvironmentEventPublisher;
  readonly history?: RepositoryHistoryService;
  readonly freshness?: RepositoryFreshnessService;
  readonly refs?: RepositoryRefsService;
}

export type RunEnvironmentEffect = (
  effect: Effect.Effect<void, never, never>,
  signal?: AbortSignal,
) => void;
