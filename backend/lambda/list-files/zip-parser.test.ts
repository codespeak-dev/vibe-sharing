import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseZipTail,
  parseEocd,
  parseCentralDirectory,
  parseFullCentralDirectory,
} from "./zip-parser";

/** Create a real ZIP buffer using the system `zip` command. */
function createZip(files: Record<string, string>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
  const zipPath = join(dir, "test.zip");

  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }

  const fileNames = Object.keys(files).join(" ");
  execSync(`cd "${dir}" && zip -r "${zipPath}" ${fileNames}`, { stdio: "pipe" });

  const buf = readFileSync(zipPath);
  rmSync(dir, { recursive: true, force: true });
  return buf;
}

/** Create an empty ZIP (just EOCD). */
function createEmptyZip(): Buffer {
  // An empty ZIP from the `zip` command needs at least one file to work,
  // so we'll construct the minimal EOCD manually.
  // EOCD: signature(4) + zeros(16) + comment_len(2) = 22 bytes
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0); // EOCD signature
  // All other fields are 0 (no entries, no central directory)
  return buf;
}

describe("parseZipTail", () => {
  it("parses a small archive with a few files", () => {
    const zip = createZip({
      "hello.txt": "Hello, World!",
      "data.json": '{"key": "value"}',
    });

    const result = parseZipTail(zip, 0);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");

    const paths = result.entries.map((e) => e.path).sort();
    expect(paths).toEqual(["data.json", "hello.txt"]);

    const hello = result.entries.find((e) => e.path === "hello.txt")!;
    expect(hello.size).toBe(13); // "Hello, World!" length
  });

  it("parses an empty archive", () => {
    const zip = createEmptyZip();
    const result = parseZipTail(zip, 0);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.entries).toEqual([]);
  });

  it("parses nested directory structures", () => {
    const zip = createZip({
      "a/b/c/deep.txt": "deep content",
      "a/b/mid.txt": "mid content",
      "a/top.txt": "top content",
      "root.txt": "root content",
    });

    const result = parseZipTail(zip, 0);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");

    const paths = result.entries.map((e) => e.path).sort();
    expect(paths).toEqual([
      "a/b/c/deep.txt",
      "a/b/mid.txt",
      "a/top.txt",
      "root.txt",
    ]);
  });

  it("skips directory-only entries", () => {
    const zip = createZip({
      "dir/file.txt": "content",
    });

    const result = parseZipTail(zip, 0);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");

    // Should not include "dir/" as an entry
    const dirEntries = result.entries.filter((e) => e.path.endsWith("/"));
    expect(dirEntries).toEqual([]);
  });

  it("returns need-more-data when tail buffer is too small", () => {
    const zip = createZip({
      "a.txt": "aaa",
      "b.txt": "bbb",
      "c.txt": "ccc",
    });

    // Only provide the last 30 bytes (enough for EOCD but not central directory)
    const tailSize = 30;
    const tailStart = zip.length - tailSize;
    const tailBuffer = zip.subarray(tailStart);

    const result = parseZipTail(tailBuffer, tailStart);

    // The central directory likely starts before our tail buffer
    if (result.kind === "need-more-data") {
      expect(result.cdOffset).toBeGreaterThanOrEqual(0);
      expect(result.cdSize).toBeGreaterThan(0);

      // Now fetch the full central directory and parse it
      const eocd = parseEocd(tailBuffer, tailStart);
      expect("totalEntries" in eocd).toBe(true);
      if (!("totalEntries" in eocd)) throw new Error("expected eocd");

      const cdBuffer = zip.subarray(result.cdOffset, result.cdOffset + result.cdSize);
      const fullResult = parseFullCentralDirectory(cdBuffer, eocd.totalEntries);
      expect(fullResult.kind).toBe("ok");
      if (fullResult.kind !== "ok") throw new Error("expected ok");
      expect(fullResult.entries.length).toBeGreaterThanOrEqual(3);
    } else if (result.kind === "ok") {
      // If the ZIP is tiny enough that 30 bytes covers everything, that's also fine
      expect(result.entries.length).toBeGreaterThanOrEqual(3);
    } else {
      throw new Error(`Unexpected result: ${result.kind}`);
    }
  });

  it("handles the two-pass fetch for archives with many files", () => {
    // Create a ZIP with enough files that the central directory is substantial
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      files[`dir${Math.floor(i / 10)}/file-${i.toString().padStart(3, "0")}.txt`] =
        `content of file ${i}`;
    }
    const zip = createZip(files);

    // Simulate reading just the tail (64KB or less)
    const tailSize = Math.min(65557, zip.length);
    const tailStart = zip.length - tailSize;
    const tailBuffer = zip.subarray(tailStart);

    const result = parseZipTail(tailBuffer, tailStart);

    if (result.kind === "need-more-data") {
      // Second pass: fetch exactly the central directory
      const cdBuffer = zip.subarray(result.cdOffset, result.cdOffset + result.cdSize);
      const eocd = parseEocd(tailBuffer, tailStart);
      expect("totalEntries" in eocd).toBe(true);
      if (!("totalEntries" in eocd)) throw new Error("expected eocd");

      const fullResult = parseFullCentralDirectory(cdBuffer, eocd.totalEntries);
      expect(fullResult.kind).toBe("ok");
      if (fullResult.kind !== "ok") throw new Error("expected ok");

      // Should have 100 files (directory entries are skipped)
      expect(fullResult.entries.length).toBe(100);
    } else if (result.kind === "ok") {
      // The 64KB tail was enough to cover everything
      expect(result.entries.length).toBe(100);
    } else {
      throw new Error(`Unexpected: ${JSON.stringify(result)}`);
    }
  });

  it("returns error for non-ZIP data", () => {
    const buf = Buffer.from("this is not a zip file at all");
    const result = parseZipTail(buf, 0);
    expect(result.kind).toBe("error");
  });

  it("handles ZIP with a comment after EOCD", () => {
    // Create a valid ZIP and append a comment
    const zip = createZip({ "test.txt": "hello" });

    // Find the EOCD and set a comment
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        const comment = Buffer.from("This is a ZIP comment");
        zip.writeUInt16LE(comment.length, i + 20); // comment length field
        const withComment = Buffer.concat([zip.subarray(0, i + 22), comment]);
        const result = parseZipTail(withComment, 0);
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") throw new Error("expected ok");
        expect(result.entries.length).toBe(1);
        expect(result.entries[0].path).toBe("test.txt");
        return;
      }
    }
    throw new Error("Could not find EOCD in test ZIP");
  });
});

describe("parseEocd", () => {
  it("finds EOCD at the very end of the buffer", () => {
    const zip = createZip({ "a.txt": "a" });
    const result = parseEocd(zip, 0);
    expect("totalEntries" in result).toBe(true);
  });

  it("returns error for garbage data", () => {
    const buf = Buffer.alloc(100, 0xff);
    const result = parseEocd(buf, 0);
    expect("error" in result).toBe(true);
  });
});

describe("parseCentralDirectory", () => {
  it("returns error for truncated data", () => {
    const buf = Buffer.alloc(10); // too small
    const result = parseCentralDirectory(buf, 1);
    expect("error" in result).toBe(true);
  });

  it("returns error for invalid signature", () => {
    const buf = Buffer.alloc(50, 0);
    buf.writeUInt32LE(0xdeadbeef, 0); // wrong signature
    const result = parseCentralDirectory(buf, 1);
    expect("error" in result).toBe(true);
  });
});
