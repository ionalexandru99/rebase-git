import {
  createCurrentEnvironmentDiscovery,
  type EnvironmentCapabilityName,
  type EnvironmentDiscovery,
} from "@rebase/contracts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";

export interface EnvironmentTransportState {
  readonly discovery: EnvironmentDiscovery;
  readonly events: EnvironmentEventPublisher;
}

const transportCapabilities: readonly EnvironmentCapabilityName[] = [
  "environment-events",
  "sequence-resnapshot",
  "json-fragmentation",
  "repository-ref-events",
];

export function createEnvironmentTransportDiscovery(
  environmentId: string,
  productVersion: string,
  capabilities: readonly EnvironmentCapabilityName[],
): EnvironmentDiscovery {
  const discovery = createCurrentEnvironmentDiscovery(
    environmentId,
    productVersion,
  );
  const advertised = new Set<string>([
    ...transportCapabilities,
    ...capabilities,
  ]);
  return {
    ...discovery,
    capabilities: discovery.capabilities.filter(({ name }) =>
      advertised.has(name),
    ),
  };
}
