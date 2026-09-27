import {
  EnvironmentGreeting,
  EnvironmentHello,
  EnvironmentRpc,
  ProtocolMismatch,
} from "@rebase/contracts";
import { Schema } from "effect";
import { expect, it } from "vite-plus/test";

const hello = { protocol: 4 };
const greeting = {
  environmentId: "00000000-0000-4000-8000-000000000001",
  sequence: 3,
};
const mismatch = { _tag: "ProtocolMismatch", serverProtocol: 5 };

it("keeps the handshake readable across protocol numbers", () => {
  expect(EnvironmentRpc.requests.get("Hello")?.payloadSchema).toBe(
    EnvironmentHello,
  );
  expect(Schema.decodeUnknownSync(EnvironmentHello)(hello)).toEqual(hello);
  expect(Schema.decodeUnknownSync(EnvironmentGreeting)(greeting)).toEqual(
    greeting,
  );
  expect(Schema.decodeUnknownSync(ProtocolMismatch)(mismatch)).toEqual(
    mismatch,
  );
});
