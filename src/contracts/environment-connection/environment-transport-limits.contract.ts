import { Schema } from "effect";

const ByteLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1_024, maximum: 67_108_864 }),
);
const QueueLength = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 4_096 }),
);
const TimeoutMilliseconds = Schema.Int.check(
  Schema.isBetween({ minimum: 100, maximum: 60_000 }),
);

export const TransportLimits = Schema.Struct({
  maxHttpRequestBytes: ByteLimit,
  maxHttpResponseBytes: ByteLimit,
  maxWebSocketRequestBytes: ByteLimit,
  maxWebSocketResponseBytes: ByteLimit,
  maxQueuedEvents: QueueLength,
  maxQueuedEventBytes: ByteLimit,
  maxCapturedOutputBytes: ByteLimit,
  helloTimeoutMilliseconds: TimeoutMilliseconds,
});

export type TransportLimits = typeof TransportLimits.Type;

export const ClientReceiveLimits = Schema.Struct({
  maxCapturedOutputBytes: ByteLimit,
  maxHttpResponseBytes: ByteLimit,
  maxWebSocketResponseBytes: ByteLimit,
});

export type ClientReceiveLimits = typeof ClientReceiveLimits.Type;

export const currentTransportLimits = {
  helloTimeoutMilliseconds: 5_000,
  maxCapturedOutputBytes: 1_048_576,
  maxHttpRequestBytes: 65_536,
  maxHttpResponseBytes: 1_048_576,
  maxQueuedEventBytes: 262_144,
  maxQueuedEvents: 128,
  maxWebSocketRequestBytes: 16_384,
  maxWebSocketResponseBytes: 16_384,
} satisfies TransportLimits;

export const currentClientReceiveLimits = {
  maxCapturedOutputBytes: currentTransportLimits.maxCapturedOutputBytes,
  maxHttpResponseBytes: currentTransportLimits.maxHttpResponseBytes,
  maxWebSocketResponseBytes: currentTransportLimits.maxWebSocketResponseBytes,
} satisfies ClientReceiveLimits;
