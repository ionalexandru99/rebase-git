import { expect, it } from "vite-plus/test";
import {
  EnvironmentGreeting,
  EnvironmentHello,
  EnvironmentSessionApi,
  ProtocolMismatch,
} from "#contracts/environment-connection/environment-rpc.contract.ts";

const hello = { protocol: 4 };
const greeting = {
  environmentId: "00000000-0000-4000-8000-000000000001",
};
const mismatch = { _tag: "ProtocolMismatch", serverProtocol: 5 };

it("keeps the handshake readable across protocol numbers", () => {
  expect(EnvironmentSessionApi.hello.request).toBe(EnvironmentHello);
  expect(EnvironmentHello.parse(hello)).toEqual(hello);
  expect(EnvironmentGreeting.parse(greeting)).toEqual(greeting);
  expect(ProtocolMismatch.parse(mismatch)).toEqual(mismatch);
});
