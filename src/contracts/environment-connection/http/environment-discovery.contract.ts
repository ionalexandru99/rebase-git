import {
  currentTransportLimits,
  TransportLimits,
} from "@rebase/contracts/environment-connection/environment-transport-limits.contract";
import {
  currentEnvironmentCapabilities,
  currentEnvironmentProtocol,
  EnvironmentCapabilities,
  ProductVersionSchema,
  ProtocolRange,
} from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import {
  InvalidMessage,
  PayloadTooLarge,
} from "@rebase/contracts/environment-connection/websocket/environment-live-connection.contract";
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

export const EnvironmentHttpFailure = Schema.Union([
  InvalidMessage,
  PayloadTooLarge,
]);

export type EnvironmentHttpFailure = typeof EnvironmentHttpFailure.Type;

export const EnvironmentHttpApi = {
  discovery: {
    failure: EnvironmentHttpFailure,
    failureStatuses: [400, 413] as const,
    method: "GET",
    path: environmentDiscoveryPath,
    success: EnvironmentDiscovery,
    successStatus: 200,
  },
  snapshot: {
    failure: EnvironmentHttpFailure,
    failureStatuses: [400, 413] as const,
    method: "GET",
    path: environmentSnapshotPath,
    success: EnvironmentSnapshot,
    successStatus: 200,
  },
} as const;

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
