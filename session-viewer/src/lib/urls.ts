/** Encode a project path for use in URL path segments (base64url). */
export function encodeForUrl(path: string): string {
  return Buffer.from(path).toString("base64url");
}

/** Decode a base64url-encoded project path from a URL segment. */
export function decodeFromUrl(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf-8");
}
