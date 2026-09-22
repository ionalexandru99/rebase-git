import { readdirSync } from "node:fs";
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["import"],
    categories: { correctness: "off" },
    rules: {
      "import/no-cycle": "error",
      "import/no-relative-parent-imports": "error",
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    overrides: ["web", "server", "desktop"].flatMap((application) =>
      readdirSync(
        new URL(`./src/apps/${application}/features`, import.meta.url),
        {
          withFileTypes: true,
        },
      )
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => ({
          files: [`src/apps/${application}/features/${name}/**`],
          rules: {
            "no-restricted-imports": [
              "error",
              {
                patterns: [
                  {
                    group: (application === "web"
                      ? ["#web", "#web-ui"]
                      : [`#${application}`]
                    ).flatMap((alias) => [
                      `${alias}/features/*/**`,
                      `!${alias}/features/${name}/**`,
                      `!${alias}/features/*/index`,
                      `!${alias}/features/*/api`,
                      `!${alias}/features/*/*.contract`,
                    ]),
                    message:
                      "Use the feature's public entry point or public contract.",
                  },
                ],
              },
            ],
          },
        })),
    ),
  },
});
