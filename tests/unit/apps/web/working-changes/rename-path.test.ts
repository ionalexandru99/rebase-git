import { describe, expect, it } from "vite-plus/test";
import {
  compactRename,
  renameHint,
} from "#web/features/working-changes/rename/rename-path";

describe("rename paths", () => {
  it.each([
    [
      "src/components/legacy/Button.tsx",
      "src/components/ui/Button.tsx",
      "legacy/",
      "src/components/{legacy → ui}/Button.tsx",
    ],
    [
      "docs/readme.md",
      "docs/README.md",
      "readme.md",
      "docs/{readme.md → README.md}",
    ],
    [
      "src/utils/fmt.ts",
      "src/lib/format.ts",
      "utils/fmt.ts",
      "src/{utils/fmt.ts → lib/format.ts}",
    ],
    [
      "src/Button.tsx",
      "src/components/ui/Button.tsx",
      "src/",
      "src/{ → components/ui}/Button.tsx",
    ],
    ["a/b/c/x.ts", "a/x.ts", "b/c/", "a/{b/c → }/x.ts"],
    ["Button.tsx", "src/Button.tsx", "/", "{ → src}/Button.tsx"],
  ])("%s → %s", (previousPath, path, hint, compact) => {
    expect(renameHint(previousPath, path)).toBe(hint);
    expect(compactRename(previousPath, path)).toBe(compact);
  });
});
