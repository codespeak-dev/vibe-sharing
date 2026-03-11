import fsp from "node:fs/promises";
import path from "node:path";
import { API_BASE_URL } from "../config.js";
import { networkError, uploadFailed, VibeError } from "../utils/errors.js";

interface PresignResponse {
  uploadUrl: string;
  uploadId: string;
}

interface ConfirmResponse {
  shareUrl: string;
}

export interface UploadResult {
  shareUrl: string;
  uploadId: string;
}

/**
 * Upload a zip file to S3 via presigned URL.
 * Returns the share URL on success.
 */
export async function uploadArchive(
  zipPath: string,
  sizeBytes: number,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  // Step 1: Get presigned URL from backend
  let presign: PresignResponse;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: path.basename(zipPath),
        sizeBytes,
        contentType: "application/zip",
      }),
    });

    if (!response.ok) {
      throw new Error(`Presign request failed: ${response.status} ${response.statusText}`);
    }

    presign = (await response.json()) as PresignResponse;
  } catch (err) {
    if (err instanceof VibeError) throw err;
    throw networkError(err);
  }

  // Step 2: Upload to S3
  try {
    const fileBuffer = await fsp.readFile(zipPath);

    const response = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(sizeBytes),
      },
      body: fileBuffer,
    });

    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
    }

    onProgress?.(100);
  } catch (err) {
    if (err instanceof VibeError) throw err;
    throw uploadFailed(err);
  }

  // Step 3: Confirm upload
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: presign.uploadId }),
    });

    if (!response.ok) {
      throw new Error(`Confirm request failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as ConfirmResponse;
    return { shareUrl: result.shareUrl, uploadId: presign.uploadId };
  } catch (err) {
    if (err instanceof VibeError) throw err;
    throw uploadFailed(err);
  }
}

/**
 * Check if the upload backend is configured and reachable.
 */
export async function isBackendAvailable(): Promise<boolean> {
  if (!API_BASE_URL || API_BASE_URL === "https://api.codespeak.dev") {
    // Check if the backend is actually reachable
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${API_BASE_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }
  return true; // Custom URL configured, assume it works
}

/**
 * Copy the zip file to a local output path.
 */
export async function saveLocally(
  zipPath: string,
  outputPath: string,
): Promise<void> {
  await fsp.copyFile(zipPath, outputPath);
}
