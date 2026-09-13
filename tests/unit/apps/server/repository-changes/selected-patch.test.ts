import { describe, expect, it } from "vite-plus/test";
import { selectedChangeText } from "#server/features/repository-changes/patch/selected-change-text";

describe("selected changes", () => {
  const before = "one\ntwo\nthree\n";
  const after = "ONE\nTWO\nthree\nextra";
  it("stages selected additions and deletions without the rest of a hunk", () => {
    expect(selectedChangeText(before, after, ["-1", "+1"], false)).toBe(
      "two\nONE\nthree\n",
    );
  });
  it("unstages selected lines while retaining other staged lines and final-newline state", () => {
    expect(selectedChangeText(before, after, ["-1", "+1"], true)).toBe(
      "one\nTWO\nthree\nextra",
    );
  });
  it("preserves CRLF and Unicode text", () => {
    expect(
      selectedChangeText("café\r\n", "👩‍💻\r\n", ["-1", "+1"], false),
    ).toBe("👩‍💻\r\n");
  });
  it("rejects a selection that no longer identifies changed lines", () => {
    expect(() => selectedChangeText(before, after, ["+3"], false)).toThrow();
  });
});
