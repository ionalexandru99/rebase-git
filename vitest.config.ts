import { defineConfig } from "vitest/config";

const testProject = (name: "compatibility" | "integration" | "unit") => ({
  test: {
    environment: "node" as const,
    include: [`tests/${name}/**/*.test.ts`],
    name,
  },
});

export default defineConfig({
  test: {
    projects: [
      testProject("unit"),
      testProject("integration"),
      testProject("compatibility"),
    ],
  },
});
