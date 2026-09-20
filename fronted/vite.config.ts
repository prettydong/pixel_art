import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
  // The transition is lazy-loaded. Prepare its dependencies at server startup
  // rather than discovering them on the first card click.
  optimizeDeps: { include: ["pixi.js", "html-to-image"] },
});
