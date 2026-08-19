import { defineConfig } from "vitest/config";

const testProject = (name: "compatibility" | "integration" | "unit") => ({
  extends: true as const,
  test: {
    environment: "node" as const,
    include: [`tests/${name}/**/*.test.ts`],
    name,
  },
});

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["rebase-source", "import", "default"],
    },
  },
  test: {
    projects: [
      testProject("unit"),
      testProject("integration"),
      testProject("compatibility"),
    ],
  },
});
