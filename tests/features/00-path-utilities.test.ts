/**
 * Cross-cutting utility tests. Not tied to a specific BDD feature, but several
 * scenarios depend on these primitives behaving correctly:
 *  - "Identify archive by repository or folder name" (Feature 16)
 *  - "View shortened and linked repository URL" (Feature 17)
 *  - "Encode/decode project paths" (Features 21, 29 — Claude Code session lookup)
 */
import { describe, expect, test } from "vitest";
import {
  decodeProjectPath,
  encodeProjectPath,
  getRepoName,
  normalizePath,
  normalizeRemoteUrl,
} from "../../src/utils/paths.js";

describe("paths.encodeProjectPath / decodeProjectPath", () => {
  test("encodes posix paths by replacing slashes with dashes", () => {
    expect(encodeProjectPath("/Users/foo/proj")).toBe("-Users-foo-proj");
  });

  test("encodes windows backslash paths after normalization", () => {
    expect(encodeProjectPath("C:\\Users\\foo\\proj")).toBe(
      "C:-Users-foo-proj",
    );
  });

  test("decode is the lossy inverse for paths without literal dashes", () => {
    const original = "/Users/foo/proj";
    expect(decodeProjectPath(encodeProjectPath(original))).toBe(original);
  });
});

describe("paths.normalizePath", () => {
  test("strips trailing slashes", () => {
    const a = normalizePath("/foo/bar/");
    const b = normalizePath("/foo/bar");
    expect(a).toBe(b);
  });
});

describe("paths.getRepoName", () => {
  test("https remote with .git suffix", () => {
    expect(getRepoName("https://github.com/codespeak-dev/vibe-sharing.git")).toBe(
      "vibe-sharing",
    );
  });

  test("https remote without .git suffix", () => {
    expect(getRepoName("https://github.com/codespeak-dev/vibe-sharing")).toBe(
      "vibe-sharing",
    );
  });

  test("ssh remote", () => {
    expect(getRepoName("git@github.com:codespeak-dev/vibe-sharing.git")).toBe(
      "vibe-sharing",
    );
  });
});

describe("paths.normalizeRemoteUrl", () => {
  test("https and ssh forms compare equal after normalization", () => {
    const https = normalizeRemoteUrl(
      "https://github.com/codespeak-dev/vibe-sharing.git",
    );
    const ssh = normalizeRemoteUrl(
      "git@github.com:codespeak-dev/vibe-sharing.git",
    );
    expect(https).toBe(ssh);
  });

  test("trailing slashes are stripped", () => {
    expect(normalizeRemoteUrl("https://github.com/foo/bar/")).toBe(
      normalizeRemoteUrl("https://github.com/foo/bar"),
    );
  });

  test("hostname is lowercased", () => {
    expect(normalizeRemoteUrl("https://GitHub.com/Foo/Bar")).toBe(
      "github.com/Foo/Bar",
    );
  });
});
