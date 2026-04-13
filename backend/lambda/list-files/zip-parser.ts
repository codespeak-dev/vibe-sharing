/**
 * ZIP central directory parser.
 *
 * Reads the End of Central Directory (EOCD) record and central directory
 * entries from a buffer to extract file listings without decompressing.
 */

export interface ZipEntry {
  path: string;
  size: number; // uncompressed
  compressedSize: number;
}

/** Returned when the initial tail buffer doesn't contain the full central directory. */
export interface NeedMoreData {
  kind: "need-more-data";
  /** Absolute byte offset in the ZIP file where the central directory starts. */
  cdOffset: number;
  /** Size of the central directory in bytes. */
  cdSize: number;
}

export type ParseResult =
  | { kind: "ok"; entries: ZipEntry[] }
  | NeedMoreData
  | { kind: "error"; message: string };

// Signatures
const EOCD_SIG = 0x06054b50;
const CD_ENTRY_SIG = 0x02014b50;

// Fixed sizes
const EOCD_MIN_SIZE = 22;
const CD_ENTRY_HEADER_SIZE = 46;

/**
 * Parse the EOCD from a tail buffer to find central directory location.
 *
 * @param tailBuffer - Buffer containing the tail of the ZIP file
 * @param tailStartOffset - Absolute byte offset in the ZIP file where tailBuffer starts
 */
export function parseEocd(
  tailBuffer: Buffer,
  _tailStartOffset: number
): { totalEntries: number; cdSize: number; cdOffset: number } | { error: string } {
  // Scan backwards for the EOCD signature.
  // The EOCD can have a variable-length comment, so we search from the end.
  const buf = tailBuffer;
  const minPos = Math.max(0, buf.length - 65557); // max comment = 65535

  for (let i = buf.length - EOCD_MIN_SIZE; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      const totalEntries = buf.readUInt16LE(i + 10);
      const cdSize = buf.readUInt32LE(i + 12);
      const cdOffset = buf.readUInt32LE(i + 16);

      // Check for ZIP64 marker values
      if (cdOffset === 0xffffffff || cdSize === 0xffffffff || totalEntries === 0xffff) {
        return { error: "ZIP64 archives are not supported" };
      }

      return { totalEntries, cdSize, cdOffset };
    }
  }

  return { error: "Could not find End of Central Directory record" };
}

/**
 * Parse central directory entries from a buffer.
 *
 * @param cdBuffer - Buffer containing the central directory bytes
 * @param expectedEntries - Expected number of entries from the EOCD
 */
export function parseCentralDirectory(
  cdBuffer: Buffer,
  expectedEntries: number
): ZipEntry[] | { error: string } {
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (let i = 0; i < expectedEntries; i++) {
    if (offset + CD_ENTRY_HEADER_SIZE > cdBuffer.length) {
      return { error: `Central directory truncated at entry ${i}` };
    }

    const sig = cdBuffer.readUInt32LE(offset);
    if (sig !== CD_ENTRY_SIG) {
      return { error: `Invalid central directory entry signature at entry ${i}` };
    }

    const compressedSize = cdBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = cdBuffer.readUInt32LE(offset + 24);
    const filenameLen = cdBuffer.readUInt16LE(offset + 28);
    const extraLen = cdBuffer.readUInt16LE(offset + 30);
    const commentLen = cdBuffer.readUInt16LE(offset + 32);

    const filenameStart = offset + CD_ENTRY_HEADER_SIZE;
    if (filenameStart + filenameLen > cdBuffer.length) {
      return { error: `Central directory truncated at entry ${i} filename` };
    }

    const path = cdBuffer.subarray(filenameStart, filenameStart + filenameLen).toString("utf8");

    // Skip directory-only entries (paths ending with /)
    if (filenameLen > 0 && !path.endsWith("/")) {
      entries.push({
        path,
        size: uncompressedSize,
        compressedSize,
      });
    }

    offset = filenameStart + filenameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Parse a ZIP tail buffer to extract the file listing.
 *
 * If the tail buffer doesn't contain the full central directory, returns
 * a `NeedMoreData` result with the exact offset and size needed.
 *
 * @param tailBuffer - Buffer containing the tail of the ZIP file
 * @param tailStartOffset - Absolute byte offset in the ZIP file where tailBuffer starts
 */
export function parseZipTail(tailBuffer: Buffer, tailStartOffset: number): ParseResult {
  const eocd = parseEocd(tailBuffer, tailStartOffset);
  if ("error" in eocd) {
    return { kind: "error", message: eocd.error };
  }

  const { totalEntries, cdSize, cdOffset } = eocd;

  if (totalEntries === 0) {
    return { kind: "ok", entries: [] };
  }

  // Check if the central directory is fully contained in our tail buffer
  if (cdOffset < tailStartOffset) {
    return {
      kind: "need-more-data",
      cdOffset,
      cdSize,
    };
  }

  // Extract the central directory portion from the tail buffer
  const cdLocalOffset = cdOffset - tailStartOffset;
  if (cdLocalOffset + cdSize > tailBuffer.length) {
    return {
      kind: "need-more-data",
      cdOffset,
      cdSize,
    };
  }

  const cdBuffer = tailBuffer.subarray(cdLocalOffset, cdLocalOffset + cdSize);
  const entries = parseCentralDirectory(cdBuffer, totalEntries);

  if ("error" in entries) {
    return { kind: "error", message: entries.error };
  }

  return { kind: "ok", entries };
}

/**
 * Parse a complete central directory buffer (used after a second fetch).
 */
export function parseFullCentralDirectory(
  cdBuffer: Buffer,
  totalEntries: number
): ParseResult {
  const entries = parseCentralDirectory(cdBuffer, totalEntries);
  if ("error" in entries) {
    return { kind: "error", message: entries.error };
  }
  return { kind: "ok", entries };
}
