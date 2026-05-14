import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";

/**
 * Feature 24 is about npm publication mechanics. We can assert the package.json
 * static contract that controls publication (bin name, files allowlist,
 * prepublishOnly script). The actual publish/install/npx run requires the
 * real npm registry and can't be exercised in this harness.
 */
describe("Feature: npm Package Publication", () => {
  test("Package declares bin command name 'codespeak-vibe-share' for global install invocations", async () => {
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(pkg.bin).toBeDefined();
    expect(typeof pkg.bin).toBe("object");
    expect(pkg.bin).toHaveProperty("codespeak-vibe-share");
  });

  test("Package 'files' field restricts published files to dist/ only", async () => {
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(pkg.files).toEqual(["dist"]);
  });

  test("prepublishOnly script compiles TypeScript via tsc", async () => {
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(pkg.scripts.prepublishOnly).toBe("tsc");
  });

  test("Package type is module (ESM publish target)", async () => {
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(pkg.type).toBe("module");
  });

  test("Engines field documents minimum Node version (so npx user gets a clear error on old Node)", async () => {
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toBeDefined();
  });

  test.skip(
    "Run npx scoped package without prior installation: requires real npm registry round-trip",
    () => {},
  );
  test.skip(
    "Verify package installs and executes after publishing: requires real npm registry",
    () => {},
  );
  test.skip(
    "Authenticate with npm before publishing: interactive npm login flow",
    () => {},
  );
  test.skip(
    "Bump version and create git commit and tag automatically: `npm version` mutates working tree; not safe to run in tests",
    () => {},
  );
});
