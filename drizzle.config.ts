import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./src/apps/server/persistence/migrations",
  schema: "./src/apps/server/persistence/environment-state.schema.ts",
});
