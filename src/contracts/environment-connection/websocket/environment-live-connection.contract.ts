import { EnvironmentAccessCapability } from "@rebase/contracts/environment-authorization/environment-access-capability.contract";
import {
  InvalidMessage,
  PayloadTooLarge,
} from "@rebase/contracts/environment-connection/environment-request-failure.contract";

export {
  InvalidMessage,
  PayloadTooLarge,
} from "@rebase/contracts/environment-connection/environment-request-failure.contract";

import {
  ClientReceiveLimits,
  currentClientReceiveLimits,
  TransportLimits,
} from "@rebase/contracts/environment-connection/environment-transport-limits.contract";
import {
  currentEnvironmentCapabilities,
  currentEnvironmentProtocol,
  EnvironmentCapabilities,
  ProductVersionSchema,
  ProtocolRange,
} from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { Schema } from "effect";

export const EnvironmentHello = Schema.TaggedStruct("Hello", {
  productVersion: ProductVersionSchema,
  protocol: ProtocolRange,
  capabilities: EnvironmentCapabilities,
  receiveLimits: ClientReceiveLimits,
  lastObservedSequence: Schema.optionalKey(Schema.Natural),
});

export type EnvironmentHello = typeof EnvironmentHello.Type;

const ProtocolMajorMismatch = Schema.TaggedStruct("ProtocolMajorMismatch", {
  clientMajor: Schema.Natural,
  serverMajor: Schema.Natural,
  requiredUpdate: Schema.Literals(["client", "server"]),
});

const ProtocolMinorMismatch = Schema.TaggedStruct("ProtocolMinorMismatch", {
  clientMinor: Schema.Natural,
  clientMinimumSupportedMinor: Schema.Natural,
  serverMinor: Schema.Natural,
  serverMinimumSupportedMinor: Schema.Natural,
});

const HandshakeRequired = Schema.TaggedStruct("HandshakeRequired", {});
const HandshakeAlreadyCompleted = Schema.TaggedStruct(
  "HandshakeAlreadyCompleted",
  {},
);

export const EnvironmentTransportFailure = Schema.Union([
  ProtocolMajorMismatch,
  ProtocolMinorMismatch,
  InvalidMessage,
  PayloadTooLarge,
  HandshakeRequired,
  HandshakeAlreadyCompleted,
]);

export type EnvironmentTransportFailure =
  typeof EnvironmentTransportFailure.Type;

export const HelloAccepted = Schema.TaggedStruct("HelloAccepted", {
  accessCapabilities: Schema.optionalKey(
    Schema.Array(EnvironmentAccessCapability),
  ),
  environmentId: Schema.String.check(Schema.isUUID(4)),
  protocol: Schema.Struct({
    major: Schema.Natural,
    minor: Schema.Natural,
  }),
  capabilities: EnvironmentCapabilities,
  limits: TransportLimits,
  currentSequence: Schema.Natural,
});

export type HelloAccepted = typeof HelloAccepted.Type;

export const HelloRejected = Schema.TaggedStruct("HelloRejected", {
  failure: EnvironmentTransportFailure,
});

export type HelloRejected = typeof HelloRejected.Type;

export const EnvironmentChanged = Schema.TaggedStruct("EnvironmentChanged", {
  sequence: Schema.Natural,
  repositoryIds: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isUUID(4))),
  ),
});

export const EnvironmentHelloResult = Schema.Union([
  HelloAccepted,
  HelloRejected,
]);

export type EnvironmentHelloResult = typeof EnvironmentHelloResult.Type;

export function createCurrentEnvironmentHello(
  productVersion: string,
  lastObservedSequence?: number,
): EnvironmentHello {
  return {
    _tag: "Hello",
    capabilities: currentEnvironmentCapabilities,
    receiveLimits: currentClientReceiveLimits,
    productVersion,
    protocol: currentEnvironmentProtocol,
    ...(lastObservedSequence === undefined ? {} : { lastObservedSequence }),
  };
}
