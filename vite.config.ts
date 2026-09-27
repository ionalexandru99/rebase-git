import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["import"],
    categories: { correctness: "off" },
    rules: {
      "import/no-cycle": "error",
      "import/no-relative-parent-imports": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@rebase/server/**",
                "!@rebase/server/package.json",
                "@rebase/desktop/**",
              ],
              message:
                "Use private #server/* or #desktop/* aliases for internal imports and tests. Cross-package consumers must use the public package entry point.",
            },
            {
              group: ["vitest", "vitest/**"],
              message: "Import test APIs from vite-plus/test.",
            },
          ],
        },
      ],
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "tests/.artifacts/**"],
  },
});
