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
