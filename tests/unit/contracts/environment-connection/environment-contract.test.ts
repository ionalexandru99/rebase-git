import {
  createCurrentEnvironmentHello,
  EnvironmentHello,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

describe("Environment connection contract", () => {
  it("rejects duplicate capabilities and invalid protocol ranges", () => {
    const hello = createCurrentEnvironmentHello("0.0.0");

    expect(() =>
      Schema.decodeUnknownSync(EnvironmentHello)({
        ...hello,
        capabilities: [hello.capabilities[0], hello.capabilities[0]],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EnvironmentHello)({
        ...hello,
        protocol: { major: 1, minor: 1, minimumSupportedMinor: 2 },
      }),
    ).toThrow();
  });

  it("bounds capability names while accepting additive capabilities", () => {
    const hello = createCurrentEnvironmentHello("0.0.0");
    expect(() =>
      Schema.decodeUnknownSync(EnvironmentHello)({
        ...hello,
        capabilities: [
          {
            introducedInMinor: 2,
            name: "x".repeat(65),
            version: 1,
          },
        ],
      }),
    ).toThrow();

    expect(
      Schema.decodeUnknownSync(EnvironmentHello)({
        ...hello,
        capabilities: [
          ...hello.capabilities,
          {
            introducedInMinor: 2,
            name: "future-capability",
            version: 1,
          },
        ],
      }).capabilities.at(-1),
    ).toEqual({
      introducedInMinor: 2,
      name: "future-capability",
      version: 1,
    });
  });
});
