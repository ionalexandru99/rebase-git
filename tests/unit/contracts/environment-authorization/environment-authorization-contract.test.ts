import {
  EnvironmentAuthorizationHttpApi,
  EnvironmentHttpApi,
  ExchangeEnvironmentPairing,
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

  it("declares the statuses each route can return", () => {
    expect(EnvironmentHttpApi.discovery.failureStatuses).toEqual([
      400, 403, 413,
    ]);
    expect(EnvironmentHttpApi.snapshot.failureStatuses).toEqual([
      400, 401, 403, 410, 413,
    ]);
    expect(
      EnvironmentAuthorizationHttpApi.createPairing.failureStatuses,
    ).toEqual([400, 401, 403, 410, 413]);
    expect(
      EnvironmentAuthorizationHttpApi.exchangePairing.failureStatuses,
    ).toEqual([400, 401, 403, 409, 410, 413]);
    expect(
      EnvironmentAuthorizationHttpApi.mintWebSocketTicket.failureStatuses,
    ).toEqual([400, 401, 403, 410, 413]);
    expect(
      EnvironmentAuthorizationHttpApi.revokeAuthorization.failureStatuses,
    ).toEqual([400, 401, 403, 410, 413]);
  });
});

function decodeFailure<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown,
) {
  return Schema.decodeUnknownSync(schema)(value);
}
