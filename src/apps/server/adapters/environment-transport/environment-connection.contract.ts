import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentEventPublisher } from "#server/domain/environment-event-publisher.contract";

export interface EnvironmentTransportState {
  readonly discovery: EnvironmentDiscovery;
  readonly events: EnvironmentEventPublisher;
}

export type RunEnvironmentEffect = (
  effect: Effect.Effect<void, never, never>,
  signal?: AbortSignal,
) => void;
