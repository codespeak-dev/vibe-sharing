import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Session-viewer is its own Next.js project — its tests live HERE so vitest
 * runs against session-viewer's own node_modules (its react, react-dom, next).
 * That's the only way `vi.mock("next/navigation")` etc. work as documented:
 * vitest needs to own the resolution of those packages.
 *
 * Tests at the root (../tests/) cover root-level code only.
 */
export default defineConfig({
  test: {
    include: ["tests/features/**/*.test.ts", "tests/features/**/*.test.tsx"],
    testTimeout: 30_000,
    reporters: ["default"],
    environment: "node",
  },
  resolve: {
    alias: {
      // Next.js's `@/...` path alias.
      "@/": path.resolve(__dirname, "src") + "/",
      // session-viewer imports the workspace package by name; redirect to root src.
      "codespeak-vibe-share/config": path.resolve(__dirname, "..", "src/config.ts"),
      "codespeak-vibe-share/utils/paths": path.resolve(
        __dirname,
        "..",
        "src/utils/paths.ts",
      ),
      "codespeak-vibe-share/sessions/discovery": path.resolve(
        __dirname,
        "..",
        "src/sessions/discovery.ts",
      ),
      "codespeak-vibe-share/sessions/global-discovery": path.resolve(
        __dirname,
        "..",
        "src/sessions/global-discovery.ts",
      ),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
