import { readFileSync } from "node:fs";
import {
  EnvironmentGreeting,
  EnvironmentHello,
  EnvironmentRpc,
  ProtocolMismatch,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const handshake = JSON.parse(
  readFileSync(new URL("./fixtures/handshake.json", import.meta.url), "utf8"),
) as {
  readonly hello: unknown;
  readonly greeting: unknown;
  readonly mismatch: unknown;
};

describe("Environment protocol compatibility", () => {
  it("keeps the handshake readable across protocol numbers", () => {
    const hello = EnvironmentRpc.requests.get("Hello");

    expect(hello?.payloadSchema).toBe(EnvironmentHello);
    expect(Schema.decodeUnknownSync(EnvironmentHello)(handshake.hello)).toEqual(
      handshake.hello,
    );
    expect(
      Schema.decodeUnknownSync(EnvironmentGreeting)(handshake.greeting),
    ).toEqual(handshake.greeting);
    expect(
      Schema.decodeUnknownSync(ProtocolMismatch)(handshake.mismatch),
    ).toEqual(handshake.mismatch);
  });
});
