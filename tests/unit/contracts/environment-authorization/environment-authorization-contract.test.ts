import { ExchangeEnvironmentPairing } from "@rebase/contracts";
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
});
