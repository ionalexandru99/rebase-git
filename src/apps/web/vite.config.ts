import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import packageMetadata from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.REBASE_PRODUCT_VERSION": JSON.stringify(
      packageMetadata.version,
    ),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ["rebase-source"],
  },
  build: {
    outDir: "dist/web",
  },
});
