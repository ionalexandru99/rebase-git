import { describe, expect, it } from "vite-plus/test";
import { changeTreeRows } from "#web/features/file-diff/file-tree.ts";

const files = [
  { path: "src/app/web/diff/content.tsx" },
  { path: "src/app/web/diff/hooks/use-rows.ts" },
  { path: "src/app/web/panel.tsx" },
  { path: "readme.md" },
];

const shape = (collapsed: ReadonlySet<string> = new Set()) =>
  changeTreeRows(files, true, "", collapsed).map(
    (row) => `${"  ".repeat(row.depth)}${row.name}${row.file ? "" : "/"}`,
  );

describe("changed file tree", () => {
  it("joins folders that only hold one folder into one row", () => {
    expect(shape()).toEqual([
      "readme.md",
      "src/app/web/",
      "  diff/",
      "    content.tsx",
      "    hooks/",
      "      use-rows.ts",
      "  panel.tsx",
    ]);
  });
  it("hides the files of a joined folder when it is collapsed", () => {
    expect(shape(new Set(["src/app/web/"]))).toEqual([
      "readme.md",
      "src/app/web/",
    ]);
  });
  it("gives a joined folder every file below it", () => {
    const folder = changeTreeRows(files, true, "", new Set()).find(
      (row) => row.key === "src/app/web/diff/",
    );
    expect(folder?.paths).toEqual([
      "src/app/web/diff/content.tsx",
      "src/app/web/diff/hooks/use-rows.ts",
    ]);
  });
});
