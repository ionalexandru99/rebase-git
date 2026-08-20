import {
  assertSupportedGitVersion,
  assertSupportedNodeVersion,
  parseGitVersion,
} from "@rebase/server/environment-server/runtime-requirements";
import { describe, expect, it } from "vite-plus/test";

describe("runtime requirements", () => {
  it.each(["24.0.0", "24.19.0", "24.99.99"])(
    "accepts supported Node version %s",
    (version) => {
      expect(() => assertSupportedNodeVersion(version)).not.toThrow();
    },
  );

  it.each(["23.11.1", "25.0.0"])(
    "rejects unsupported Node version %s",
    (version) => {
      expect(() => assertSupportedNodeVersion(version)).toThrow(
        `Node 24 is required. Found Node ${version}.`,
      );
    },
  );

  it.each([
    ["git version 2.34.0", "2.34.0"],
    ["git version 2.45.2.windows.1", "2.45.2"],
    ["git version 2.39.3 (Apple Git-145)", "2.39.3"],
  ])("reads Git versions from %s", (output, expected) => {
    expect(parseGitVersion(output)).toBe(expected);
  });

  it("rejects Git versions older than 2.34", () => {
    expect(() => assertSupportedGitVersion("2.33.9")).toThrow(
      "Git 2.34 or newer is required. Found Git 2.33.9.",
    );
  });
});
