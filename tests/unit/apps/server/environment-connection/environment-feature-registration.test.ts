import { Effect } from "effect";
import { expect, it } from "vite-plus/test";
import { validateEnvironmentRpcHandlers } from "#server/adapters/environment-transport/validate-environment-features";

it("rejects missing declared RPC handlers", () => {
  expect(() => validateEnvironmentRpcHandlers(["ReadRefs"], {})).toThrow(
    "Missing RPC handler: ReadRefs",
  );
});

it("rejects undeclared RPC handlers before they can replace another feature", () => {
  expect(() =>
    validateEnvironmentRpcHandlers([], { ReadRefs: () => Effect.never }),
  ).toThrow("Undeclared RPC handler: ReadRefs");
});

it("accepts handlers matching the declared RPCs", () => {
  expect(() =>
    validateEnvironmentRpcHandlers(["ReadRefs"], {
      ReadRefs: () => Effect.never,
    }),
  ).not.toThrow();
});
