import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { EnvironmentEventPublisher } from "@rebase/server/features/environment-connection/environment-event-publisher.contract";

export interface EnvironmentTransportState {
  readonly discovery: EnvironmentDiscovery;
  readonly events: EnvironmentEventPublisher;
}
