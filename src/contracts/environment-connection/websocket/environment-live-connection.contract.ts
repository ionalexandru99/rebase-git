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
import {
  RepositoryHistoryClientMessage,
  RepositoryHistoryFailed,
  RepositoryHistorySynchronized,
} from "@rebase/contracts/repository-history/repository-history.contract";
import { Schema } from "effect";

export const EnvironmentHello = Schema.TaggedStruct("Hello", {
  productVersion: ProductVersionSchema,
  protocol: ProtocolRange,
  capabilities: EnvironmentCapabilities,
  receiveLimits: ClientReceiveLimits,
  lastObservedSequence: Schema.optionalKey(Schema.Natural),
});

export type EnvironmentHello = typeof EnvironmentHello.Type;

export const SnapshotApplied = Schema.TaggedStruct("SnapshotApplied", {
  sequence: Schema.Natural,
});

export const EnvironmentClientMessage = Schema.Union([
  EnvironmentHello,
  SnapshotApplied,
  RepositoryHistoryClientMessage,
]);

export type EnvironmentClientMessage = typeof EnvironmentClientMessage.Type;

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

export const InvalidMessage = Schema.TaggedStruct("InvalidMessage", {});
export const PayloadTooLarge = Schema.TaggedStruct("PayloadTooLarge", {
  limitBytes: Schema.Natural,
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
});

export const ResnapshotRequired = Schema.TaggedStruct("ResnapshotRequired", {
  currentSequence: Schema.Natural,
  reason: Schema.Literals(["SequenceGap", "OutgoingQueueOverflow"]),
});

export const EnvironmentHelloResult = Schema.Union([
  HelloAccepted,
  HelloRejected,
]);

export type EnvironmentHelloResult = typeof EnvironmentHelloResult.Type;

export const EnvironmentServerMessage = Schema.Union([
  HelloAccepted,
  HelloRejected,
  EnvironmentChanged,
  ResnapshotRequired,
  RepositoryHistoryFailed,
  RepositoryHistorySynchronized,
]);

export type EnvironmentServerMessage = typeof EnvironmentServerMessage.Type;

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
