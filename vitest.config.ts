import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Root vitest — covers root-level source only (src/, backend/lib/, backend/lambda/).
 * Session-viewer has its own vitest config at session-viewer/vitest.config.ts;
 * tests for the Next.js app live there because session-viewer is its own project
 * with its own react/next/node_modules.
 */
export default defineConfig({
  test: {
    include: ["tests/features/**/*.test.ts", "tests/features/**/*.test.tsx"],
    exclude: ["tests/playwright/**", "session-viewer/**"],
    testTimeout: 30_000,
    reporters: ["default"],
    environment: "node",
  },
  esbuild: {
    jsx: "automatic",
  },
});
