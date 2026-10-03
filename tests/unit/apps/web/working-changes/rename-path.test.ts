import { describe, expect, it } from "vite-plus/test";
import { renameHint } from "#web/features/working-changes/components/change-file-section.tsx";

describe("rename paths", () => {
  it.each([
    [
      "src/components/legacy/Button.tsx",
      "src/components/ui/Button.tsx",
      "legacy/",
    ],
    ["docs/readme.md", "docs/README.md", "readme.md"],
    ["src/utils/fmt.ts", "src/lib/format.ts", "utils/fmt.ts"],
    ["src/Button.tsx", "src/components/ui/Button.tsx", "src/"],
    ["a/b/c/x.ts", "a/x.ts", "b/c/"],
    ["Button.tsx", "src/Button.tsx", "/"],
  ])("%s → %s", (previousPath, path, hint) => {
    expect(renameHint(previousPath, path)).toBe(hint);
  });
});
