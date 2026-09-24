import { readdirSync } from "node:fs";
import { defineConfig } from "vite-plus";

type Application = "web" | "server" | "desktop";

const applications: readonly Application[] = ["web", "server", "desktop"];

function featureNames(application: Application) {
  return readdirSync(
    new URL(`./src/apps/${application}/features`, import.meta.url),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name);
}

function featureEntryPattern(application: Application, ownFeature?: string) {
  return {
    group: (application === "web"
      ? ["#web", "#web-ui"]
      : [`#${application}`]
    ).flatMap((alias) => [
      `${alias}/features/*/**`,
      ...(ownFeature === undefined
        ? []
        : [`!${alias}/features/${ownFeature}/**`]),
      `!${alias}/features/*/index`,
      `!${alias}/features/*/api`,
      `!${alias}/features/*/*.contract`,
    ]),
    message: "Use the feature's public entry point or public contract.",
  };
}

function testFeatureRules(testedFeature?: string) {
  return {
    "no-restricted-imports": [
      "error",
      {
        patterns: applications.map((application) =>
          featureEntryPattern(application, testedFeature),
        ),
      },
    ] satisfies [
      "error",
      { patterns: ReturnType<typeof featureEntryPattern>[] },
    ],
  };
}

const compositionTests = [
  "tests/performance/**",
  "tests/integration/apps/server/repository-access/**",
  "tests/integration/apps/web/repository-workspace/**",
];

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
      ...applications.flatMap((application) =>
        featureNames(application).flatMap((name) => {
          const patterns = [
            featureEntryPattern(application, name),
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
      {
        files: ["tests/**"],
        rules: testFeatureRules(),
      },
      ...[...new Set(applications.flatMap(featureNames))].map((name) => ({
        files: [`tests/{unit,integration,ui}/apps/*/${name}/**`],
        rules: testFeatureRules(name),
      })),
      {
        files: compositionTests,
        rules: { "no-restricted-imports": "off" as const },
      },
    ],
  },
});
