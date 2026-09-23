import {
  createCurrentEnvironmentDiscovery,
  type EnvironmentCapabilityName,
  type EnvironmentDiscovery,
} from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";

const transportCapabilities: readonly EnvironmentCapabilityName[] = [
  "environment-events",
  "sequence-resnapshot",
  "json-fragmentation",
  "repository-ref-events",
];

export function createEnvironmentTransportDiscovery(
  environmentId: string,
  productVersion: string,
  features: readonly EnvironmentFeature[],
): EnvironmentDiscovery {
  const discovery = createCurrentEnvironmentDiscovery(
    environmentId,
    productVersion,
  );
  const advertised = new Set<string>([
    ...transportCapabilities,
    ...features.flatMap((feature) => feature.capabilities),
  ]);
  return {
    ...discovery,
    capabilities: discovery.capabilities.filter(({ name }) =>
      advertised.has(name),
    ),
  };
}
