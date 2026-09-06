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
          introducedInMinor: 5,
          name: "repository-refs",
          version: 1,
        },
        {
          introducedInMinor: 4,
          name: "repository-ref-events",
          version: 1,
        },
        {
          introducedInMinor: 3,
          name: "repository-history-freshness",
          version: 1,
        },
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
          name: "json-fragmentation",
          version: 1,
        },
        {
          introducedInMinor: 3,
          name: "repository-history",
          version: 6,
        },
      ],
      protocol: { major: 2, minor: 5 },
    });
  });

  it.each(["client", "server"] as const)(
    "disables incompatible history on an older %s without disconnecting",
    (side) => {
      const discovery = createCurrentEnvironmentDiscovery(
        "00000000-0000-4000-8000-000000000001",
        "0.0.0",
      );
      const hello = createCurrentEnvironmentHello("0.0.0");
      const older = (capability: (typeof discovery.capabilities)[number]) =>
        capability.name === "repository-history"
          ? { ...capability, version: 5 }
          : capability;
      const result = negotiateEnvironmentHello(
        side === "server"
          ? { ...discovery, capabilities: discovery.capabilities.map(older) }
          : discovery,
        side === "client"
          ? { ...hello, capabilities: hello.capabilities.map(older) }
          : hello,
        0,
      );
      expect(result._tag).toBe("HelloAccepted");
      if (result._tag !== "HelloAccepted")
        throw new Error("Expected accepted connection");
      expect(
        result.capabilities.some(({ name }) => name === "repository-history"),
      ).toBe(false);
      expect(
        result.capabilities.some(({ name }) => name === "environment-events"),
      ).toBe(true);
    },
  );

  it("requires a client update for the previous WebSocket protocol", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const hello = Schema.decodeUnknownSync(EnvironmentHello)(
      oldestFixture.hello,
    );
    expect(negotiateEnvironmentHello(discovery, hello, 0)).toMatchObject({
      _tag: "HelloRejected",
      failure: {
        _tag: "ProtocolMajorMismatch",
        clientMajor: 1,
        serverMajor: 2,
        requiredUpdate: "client",
      },
    });
  });

  it("requires a server update for the previous WebSocket protocol", () => {
    const discovery = Schema.decodeUnknownSync(EnvironmentDiscovery)(
      oldestFixture.discovery,
    );
    expect(
      negotiateEnvironmentHello(
        discovery,
        createCurrentEnvironmentHello("0.0.0"),
        0,
      ),
    ).toMatchObject({
      _tag: "HelloRejected",
      failure: {
        _tag: "ProtocolMajorMismatch",
        clientMajor: 2,
        serverMajor: 1,
        requiredUpdate: "server",
      },
    });
  });

  it("rejects a major mismatch before negotiation", () => {
    const discovery = createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    );
    const hello = {
      ...createCurrentEnvironmentHello("0.0.0"),
      protocol: { major: 3, minor: 0, minimumSupportedMinor: 0 },
    };

    expect(negotiateThroughJson(discovery, hello)).toEqual({
      _tag: "HelloRejected",
      failure: {
        _tag: "ProtocolMajorMismatch",
        clientMajor: 3,
        requiredUpdate: "server",
        serverMajor: 2,
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
      protocol: { major: 2, minor: 6, minimumSupportedMinor: 6 },
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
