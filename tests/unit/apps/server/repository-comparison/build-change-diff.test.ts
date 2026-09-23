import { expect, it } from "vite-plus/test";
import { buildChangeDiff } from "#server/repository/comparison/index";

it("keeps identical content at different paths out of the same diff cache entry", () => {
  const before = {
    content: Buffer.from("before\n"),
    bytes: 7,
    mode: "100644",
    identity: "before",
  };
  const after = {
    content: Buffer.from("after\n"),
    bytes: 6,
    mode: "100644",
    identity: "after",
  };
  const first = buildChangeDiff("first.ts", "base", before, after);
  const second = buildChangeDiff("second.ts", "base", before, after);
  const renamed = buildChangeDiff("first.ts", "base", before, after, {
    previousPath: "old.ts",
  });
  expect(first.patch).not.toBe(second.patch);
  expect(first.revision).not.toBe(second.revision);
  expect(first.revision).not.toBe(renamed.revision);
});

it("stops building a text patch that would block other requests", () => {
  const file = (prefix: string) => {
    const content = Buffer.from(
      Array.from({ length: 12_000 }, (_, line) => `${prefix}${line}\n`).join(
        "",
      ),
    );
    return {
      content,
      bytes: content.length,
      mode: "100644",
      identity: prefix,
    };
  };
  expect(
    buildChangeDiff("file.ts", "base", file("before"), file("after")),
  ).toMatchObject({ kind: "large", before: null, after: null, patch: "" });
});
