import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "VibeSharing",
      formats: ["es"],
      fileName: () => "vibe-sharing-browser.mjs",
    },
    rollupOptions: {
      // Don't bundle React or sql.js — website supplies React; sql.js is loaded from CDN at runtime
      external: ["react", "react-dom", "sql.js"],
    },
    target: "es2020",
    sourcemap: true,
    minify: false,
  },
  optimizeDeps: {
    include: ["jszip", "ignore"],
  },
});
