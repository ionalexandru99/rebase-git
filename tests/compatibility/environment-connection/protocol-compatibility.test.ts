import { readFileSync } from "node:fs";
import {
  createCurrentEnvironmentDiscovery,
  createCurrentEnvironmentHello,
  EnvironmentDiscovery,
  EnvironmentHello,
  EnvironmentHelloResult,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const oldestFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/protocol-minor-0.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly accepted: unknown;
  readonly discovery: unknown;
  readonly hello: unknown;
};

const OldCapability = Schema.Struct({
  introducedInMinor: Schema.Natural,
  name: Schema.String,
  version: Schema.Int,
});
const OldProtocolRange = Schema.Struct({
  major: Schema.Natural,
  minor: Schema.Natural,
  minimumSupportedMinor: Schema.Natural,
});
const OldReceiveLimits = Schema.Struct({
  maxCapturedOutputBytes: Schema.Int,
  maxHttpResponseBytes: Schema.Int,
  maxWebSocketResponseBytes: Schema.Int,
});
const OldTransportLimits = Schema.Struct({
  helloTimeoutMilliseconds: Schema.Int,
  maxCapturedOutputBytes: Schema.Int,
  maxHttpRequestBytes: Schema.Int,
  maxHttpResponseBytes: Schema.Int,
  maxQueuedEventBytes: Schema.Int,
  maxQueuedEvents: Schema.Int,
  maxWebSocketRequestBytes: Schema.Int,
  maxWebSocketResponseBytes: Schema.Int,
});
const OldHello = Schema.TaggedStruct("Hello", {
  capabilities: Schema.Array(OldCapability),
  lastObservedSequence: Schema.optionalKey(Schema.Natural),
  productVersion: Schema.String,
  protocol: OldProtocolRange,
  receiveLimits: OldReceiveLimits,
});
const OldHelloAccepted = Schema.TaggedStruct("HelloAccepted", {
  capabilities: Schema.Array(OldCapability),
  currentSequence: Schema.Natural,
  environmentId: Schema.String,
  limits: OldTransportLimits,
  protocol: Schema.Struct({ major: Schema.Natural, minor: Schema.Natural }),
});

describe("Environment protocol compatibility", () => {
  it("negotiates current client to current server", () => {
    const discovery = serialize(
      EnvironmentDiscovery,
      createCurrentEnvironmentDiscovery(
        "00000000-0000-4000-8000-000000000001",
        "0.0.0",
      ),
    );
    const hello = serialize(
      EnvironmentHello,
      createCurrentEnvironmentHello("0.0.0"),
    );

    expect(negotiateThroughJson(discovery, hello)).toMatchObject({
      _tag: "HelloAccepted",
      capabilities: [
        {
          introducedInMinor: 0,
          name: "environment-events",
          version: 1,
        },
        {
          introducedInMinor: 1,
          name: "sequence-resnapshot",
          version: 1,
        },
        {
          introducedInMinor: 3,
          name: "binary-fragmentation",
          version: 1,
        },
        {
          introducedInMinor: 3,
          name: "repository-history",
          version: 1,
        },
      ],
      protocol: { major: 1, minor: 3 },
    });
  });

  it("negotiates the oldest client to the current server", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const oldHello = Schema.decodeUnknownSync(OldHello)(oldestFixture.hello);
    const hello = Schema.decodeUnknownSync(EnvironmentHello)(
      serializeUnknown(Schema.encodeSync(OldHello)(oldHello)),
    );

    const result = negotiateEnvironmentHello(discovery, hello, 0);
    const receivedByOldClient = Schema.decodeUnknownSync(OldHelloAccepted)(
      serializeUnknown(Schema.encodeSync(EnvironmentHelloResult)(result)),
    );
    expect(receivedByOldClient).toMatchObject({
      _tag: "HelloAccepted",
      capabilities: [{ name: "environment-events", version: 1 }],
      protocol: { major: 1, minor: 0 },
    });
  });

  it("negotiates the current client to the oldest server", () => {
    const discovery = Schema.decodeUnknownSync(EnvironmentDiscovery)(
      serializeUnknown(oldestFixture.discovery),
    );
    expect(discovery.protocol.minor).toBe(0);
    const currentHello = createCurrentEnvironmentHello("0.0.0", 12);
    Schema.decodeUnknownSync(OldHello)(
      serializeUnknown(Schema.encodeSync(EnvironmentHello)(currentHello)),
      { onExcessProperty: "error" },
    );
    const oldResult = Schema.decodeUnknownSync(OldHelloAccepted)(
      oldestFixture.accepted,
    );
    const receivedByCurrentClient = Schema.decodeUnknownSync(
      EnvironmentHelloResult,
    )(serializeUnknown(Schema.encodeSync(OldHelloAccepted)(oldResult)));

    expect(receivedByCurrentClient).toMatchObject({
      _tag: "HelloAccepted",
      capabilities: [{ name: "environment-events", version: 1 }],
      protocol: { major: 1, minor: 0 },
    });
  });

  it("rejects a major mismatch before negotiation", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const hello = {
      ...createCurrentEnvironmentHello("0.0.0"),
      protocol: { major: 2, minor: 0, minimumSupportedMinor: 0 },
    };

    expect(negotiateThroughJson(discovery, hello)).toEqual({
      _tag: "HelloRejected",
      failure: {
        _tag: "ProtocolMajorMismatch",
        clientMajor: 2,
        requiredUpdate: "server",
        serverMajor: 1,
      },
    });
  });

  it("requires an older client to update across a major mismatch", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const hello = {
      ...createCurrentEnvironmentHello("0.0.0"),
      protocol: { major: 0, minor: 0, minimumSupportedMinor: 0 },
    };

    expect(negotiateThroughJson(discovery, hello)).toMatchObject({
      _tag: "HelloRejected",
      failure: { requiredUpdate: "client" },
    });
  });

  it("rejects same-major peers without an overlapping minor range", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const hello = {
      ...createCurrentEnvironmentHello("0.0.0"),
      protocol: { major: 1, minor: 5, minimumSupportedMinor: 5 },
    };

    expect(negotiateThroughJson(discovery, hello)).toMatchObject({
      _tag: "HelloRejected",
      failure: { _tag: "ProtocolMinorMismatch" },
    });
  });

  it("keeps server input policy while honoring client receive limits", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const hello = {
      ...createCurrentEnvironmentHello("0.0.0"),
      receiveLimits: {
        maxCapturedOutputBytes: 1_024,
        maxHttpResponseBytes: 1_024,
        maxWebSocketResponseBytes: 1_024,
      },
    };

    expect(negotiateThroughJson(discovery, hello)).toMatchObject({
      _tag: "HelloAccepted",
      limits: {
        maxHttpRequestBytes: discovery.limits.maxHttpRequestBytes,
        maxHttpResponseBytes: 1_024,
        maxWebSocketRequestBytes: discovery.limits.maxWebSocketRequestBytes,
        maxWebSocketResponseBytes: 1_024,
      },
    });
  });
});

function negotiateThroughJson(
  discovery: Parameters<typeof negotiateEnvironmentHello>[0],
  hello: Parameters<typeof negotiateEnvironmentHello>[1],
) {
  return serialize(
    EnvironmentHelloResult,
    negotiateEnvironmentHello(discovery, hello, 0),
  );
}

function serialize<
  S extends Schema.ConstraintDecoder<unknown, never> &
    Schema.ConstraintEncoder<unknown, never>,
>(schema: S, value: S["Type"]) {
  return Schema.decodeUnknownSync(schema)(
    serializeUnknown(Schema.encodeSync(schema)(value)),
  );
}

function serializeUnknown(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
