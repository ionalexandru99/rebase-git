import { ObjectId, RepositoryId, RepositoryPath } from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

describe("git values contract", () => {
  it("accepts sha1 and sha256 object ids only", () => {
    const decode = Schema.decodeUnknownSync(ObjectId);
    expect(decode("a".repeat(40))).toBe("a".repeat(40));
    expect(decode("b".repeat(64))).toBe("b".repeat(64));
    expect(() => decode("a".repeat(39))).toThrow();
    expect(() => decode("A".repeat(40))).toThrow();
  });

  it("accepts only version four uuids as repository ids", () => {
    const decode = Schema.decodeUnknownSync(RepositoryId);
    expect(decode("00000000-0000-4000-8000-000000000001")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(() => decode("repository")).toThrow();
  });

  it("bounds repository paths", () => {
    const decode = Schema.decodeUnknownSync(RepositoryPath);
    expect(decode("x".repeat(4_096))).toHaveLength(4_096);
    expect(() => decode("")).toThrow();
    expect(() => decode("x".repeat(4_097))).toThrow();
  });
});
