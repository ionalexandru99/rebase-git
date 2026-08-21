import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ["rebase-source"],
  },
  build: {
    outDir: "dist/web",
  },
});
