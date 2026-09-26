import { defineConfig } from "vite-plus";

const serverFeatureProcesses = {
  group: ["node:child_process", "child_process"],
  message: "Server features run processes through domain ports.",
};

const serverFeatureAdapters = {
  group: ["#server/adapters/**"],
  message:
    "Server feature core depends on domain ports, not concrete adapters.",
};

export default defineConfig({
  lint: {
    plugins: ["import"],
    categories: { correctness: "off" },
    rules: {
      "import/no-cycle": "error",
      "import/no-relative-parent-imports": "error",
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "tests/.artifacts/**"],
    overrides: [
      {
        files: ["src/apps/server/repository/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "#server/features/**",
                    "#server/app/**",
                    "#server/adapters/**",
                  ],
                  message: "Repository workflows depend on domain ports.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/apps/web/domain/**", "src/apps/web/persistence/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["#web/features/**", "#web/app/**"],
                  message:
                    "Domain and persistence modules must not depend on browser features.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/apps/server/features/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            { patterns: [serverFeatureProcesses, serverFeatureAdapters] },
          ],
        },
      },
      {
        files: [
          "src/apps/server/features/*/http/**",
          "src/apps/server/features/*/rpc/**",
          "src/apps/server/features/*/*.feature.ts",
        ],
        rules: {
          "no-restricted-imports": [
            "error",
            { patterns: [serverFeatureProcesses] },
          ],
        },
      },
    ],
  },
});
