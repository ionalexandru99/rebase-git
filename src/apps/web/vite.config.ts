import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const packageMetadata = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { readonly version: string };

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.REBASE_PRODUCT_VERSION": JSON.stringify(
      process.env.REBASE_PRODUCT_VERSION ??
        process.env.RELEASE_VERSION ??
        packageMetadata.version,
    ),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/web",
  },
});
