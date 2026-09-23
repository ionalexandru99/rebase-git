import { IsoDate } from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

describe("IsoDate contract", () => {
  it("accepts only millisecond precision UTC timestamps", () => {
    const decode = Schema.decodeUnknownSync(IsoDate);
    expect(decode("2026-08-24T20:00:00.000Z")).toBe("2026-08-24T20:00:00.000Z");
    expect(() => decode("2026-08-24T20:00:00Z")).toThrow();
    expect(() => decode("yesterday")).toThrow();
  });
});
