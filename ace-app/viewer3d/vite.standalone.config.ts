import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
// Builds standalone.html into ONE self-contained file (JS+CSS+embedded GLB inlined)
// that opens by double-click — no server, no network.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist-standalone",
    rollupOptions: { input: "standalone.html" },
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
  },
});
