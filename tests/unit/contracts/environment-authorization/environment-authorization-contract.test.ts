import {
  EnvironmentAuthorizationHttpApi,
  EnvironmentHttpApi,
  ExchangeEnvironmentPairing,
  isEnvironmentHttpFailureStatus,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

describe("Environment authorization HTTP contract", () => {
  it("accepts only six-digit pairing codes", () => {
    expect(
      Schema.decodeUnknownSync(ExchangeEnvironmentPairing)({
        label: "Alex's workstation",
        pairingMaterial: "123-456",
      }),
    ).toEqual({
      label: "Alex's workstation",
      pairingMaterial: "123-456",
    });

    for (const pairingMaterial of [
      "123456",
      "12-3456",
      "123-45a",
      "123-4567",
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(ExchangeEnvironmentPairing)({
          label: "Alex's workstation",
          pairingMaterial,
        }),
      ).toThrow();
    }
  });

  it("keeps failures scoped to each route", () => {
    expect(
      decodeFailure(EnvironmentHttpApi.discovery.failure, {
        _tag: "InvalidHost",
      }),
    ).toEqual({ _tag: "InvalidHost" });
    expect(
      decodeFailure(EnvironmentHttpApi.snapshot.failure, {
        _tag: "InvalidGrant",
      }),
    ).toEqual({ _tag: "InvalidGrant" });
    expect(() =>
      decodeFailure(EnvironmentHttpApi.snapshot.failure, {
        _tag: "InvalidPairing",
      }),
    ).toThrow();
    expect(
      decodeFailure(EnvironmentAuthorizationHttpApi.exchangePairing.failure, {
        _tag: "InvalidPairing",
      }),
    ).toEqual({ _tag: "InvalidPairing" });
    expect(() =>
      decodeFailure(EnvironmentAuthorizationHttpApi.exchangePairing.failure, {
        _tag: "InvalidGrant",
      }),
    ).toThrow();
  });

  it("accepts transport statuses on every route and feature statuses only where declared", () => {
    const { createPairing, exchangePairing } = EnvironmentAuthorizationHttpApi;
    expect(
      isEnvironmentHttpFailureStatus(EnvironmentHttpApi.discovery, 413),
    ).toBe(true);
    expect(isEnvironmentHttpFailureStatus(createPairing, 401)).toBe(true);
    expect(isEnvironmentHttpFailureStatus(exchangePairing, 409)).toBe(true);
    expect(isEnvironmentHttpFailureStatus(createPairing, 409)).toBe(false);
    expect(isEnvironmentHttpFailureStatus(createPairing, 500)).toBe(false);
  });
});

function decodeFailure<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown,
) {
  return Schema.decodeUnknownSync(schema)(value);
}
