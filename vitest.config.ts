import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const testProject = (name: "compatibility" | "integration" | "unit") => ({
  extends: true as const,
  test: {
    environment: "node" as const,
    include: [`tests/${name}/**/*.test.ts`],
    name,
  },
});

export default defineConfig({
  resolve: {
    alias: {
      "#web": fileURLToPath(new URL("./src/apps/web", import.meta.url)),
    },
  },
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
