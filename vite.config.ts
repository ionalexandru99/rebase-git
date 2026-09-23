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
                  group: [
                    "#web/features/**",
                    "#web-ui/features/**",
                    "#web/app/**",
                    "#web-ui/app/**",
                  ],
                  message:
                    "Domain and persistence modules must not depend on browser features.",
                },
              ],
            },
          ],
        },
      },
      ...["web", "server", "desktop"].flatMap((application) =>
        readdirSync(
          new URL(`./src/apps/${application}/features`, import.meta.url),
          {
            withFileTypes: true,
          },
        )
          .filter((entry) => entry.isDirectory())
          .flatMap(({ name }) => {
            const patterns = [
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
              ...(application === "server"
                ? [
                    {
                      group: ["node:child_process", "child_process"],
                      message:
                        "Server features run processes through domain ports.",
                    },
                  ]
                : []),
            ];
            const rules = (blockAdapters: boolean) => ({
              "no-restricted-imports": [
                "error",
                {
                  patterns: [
                    ...patterns,
                    ...(blockAdapters
                      ? [
                          {
                            group: ["#server/adapters/**"],
                            message:
                              "Server feature core depends on domain ports, not concrete adapters.",
                          },
                        ]
                      : []),
                  ],
                },
              ] satisfies ["error", { patterns: typeof patterns }],
            });
            return [
              {
                files: [`src/apps/${application}/features/${name}/**`],
                rules: rules(application === "server"),
              },
              ...(application === "server"
                ? [
                    {
                      files: [
                        `src/apps/server/features/${name}/http/**`,
                        `src/apps/server/features/${name}/rpc/**`,
                        `src/apps/server/features/${name}/*.feature.ts`,
                      ],
                      rules: rules(false),
                    },
                  ]
                : []),
            ];
          }),
      ),
    ],
  },
});
