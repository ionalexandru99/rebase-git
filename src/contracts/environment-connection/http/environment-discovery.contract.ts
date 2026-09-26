import {
  currentTransportLimits,
  TransportLimits,
} from "@rebase/contracts/environment-connection/environment-transport-limits.contract";
import {
  type EnvironmentHttpRoute,
  route,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  currentEnvironmentCapabilities,
  currentEnvironmentProtocol,
  EnvironmentCapabilities,
  ProductVersionSchema,
  ProtocolRange,
} from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { Schema } from "effect";

export const environmentDiscoveryPath = "/api/discovery";
export const environmentSnapshotPath = "/api/environment/snapshot";
export const environmentLivePath = "/api/environment/live";

export const EnvironmentDiscovery = Schema.Struct({
  environmentId: Schema.String.check(Schema.isUUID(4)),
  productVersion: ProductVersionSchema,
  protocol: ProtocolRange,
  capabilities: EnvironmentCapabilities,
  limits: TransportLimits,
  routes: Schema.Struct({
    snapshot: Schema.Literal(environmentSnapshotPath),
    live: Schema.Literal(environmentLivePath),
  }),
});

export type EnvironmentDiscovery = typeof EnvironmentDiscovery.Type;

export const EnvironmentSnapshot = Schema.Struct({
  environmentId: Schema.String.check(Schema.isUUID(4)),
  sequence: Schema.Natural,
});

export type EnvironmentSnapshot = typeof EnvironmentSnapshot.Type;

export const EnvironmentHttpApi = {
  discovery: route({
    capability: null,
    method: "GET",
    path: environmentDiscoveryPath,
    success: EnvironmentDiscovery,
  }),
  snapshot: route({
    capability: "environment.read",
    method: "GET",
    path: environmentSnapshotPath,
    success: EnvironmentSnapshot,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;

export function createCurrentEnvironmentDiscovery(
  environmentId: string,
  productVersion: string,
): EnvironmentDiscovery {
  return {
    capabilities: currentEnvironmentCapabilities,
    environmentId,
    limits: currentTransportLimits,
    productVersion,
    protocol: currentEnvironmentProtocol,
    routes: {
      live: environmentLivePath,
      snapshot: environmentSnapshotPath,
    },
  };
}
