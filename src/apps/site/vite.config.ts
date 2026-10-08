import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  publicDir: "../web/public",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
  },
});
