import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { EnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher.contract";
import type { Effect } from "effect";

export interface EnvironmentTransportState {
  readonly discovery: EnvironmentDiscovery;
  readonly events: EnvironmentEventPublisher;
}

export type RunEnvironmentEffect = (
  effect: Effect.Effect<void, never, never>,
  signal?: AbortSignal,
) => void;
