import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  // Relative base so the build runs from a sub-path, Electron's file/custom
  // protocol, or a mobile WebView without absolute-path 404s.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        // Existing 2D neural avatar.
        main: resolve(__dirname, "index.html"),
        // New React Three Fiber 3D avatar.
        ace3d: resolve(__dirname, "ace-3d.html"),
      },
    },
  },
});
