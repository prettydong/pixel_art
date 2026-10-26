import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Generate alternate encodings at build time; serving them does not consume request-time CPU.
function compressedAssets(): Plugin {
  return {
    name: "compressed-assets",
    apply: "build",
    async writeBundle(options, bundle) {
      if (!options.dir) return;
      const directory = options.dir;
      // Vite injects preload dependencies late; compress the final files after they are written.
      await Promise.all(Object.values(bundle).map(async file => {
        if (!/\.(?:js|css)$/.test(file.fileName)) return;
        const path = join(directory, file.fileName);
        const bytes = await readFile(path);
        if (bytes.length < 1024) return;
        await Promise.all([
          writeFile(`${path}.gz`, gzipSync(bytes, { level: 9 })),
          writeFile(`${path}.br`, brotliCompressSync(bytes, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT },
          })),
        ]);
      }));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), compressedAssets()],
  server: { proxy: { "/api": "http://localhost:3000" } },
  // The transition is lazy-loaded. Prepare its dependencies at server startup
  // rather than discovering them on the first card click.
  optimizeDeps: { include: ["pixi.js", "html-to-image"] },
});
