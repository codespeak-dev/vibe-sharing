import fsp from "node:fs/promises";
import path from "node:path";
import { API_BASE_URL, isDefaultApiUrl } from "../config.js";
import { networkError, uploadFailed, VibeError } from "../utils/errors.js";

interface PresignResponse {
  uploadUrl: string;
  uploadId: string;
}

export interface UploadMetadata {
  userEmail?: string;
  userName?: string;
  repoUrl?: string;
}

export interface UploadResult {
  uploadId: string;
}

/**
 * Upload a zip file to S3 via presigned URL.
 */
export async function uploadArchive(
  zipPath: string,
  sizeBytes: number,
  onProgress?: (percent: number) => void,
  metadata?: UploadMetadata,
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
        ...(metadata?.userEmail && { userEmail: metadata.userEmail }),
        ...(metadata?.userName && { userName: metadata.userName }),
        ...(metadata?.repoUrl && { repoUrl: metadata.repoUrl }),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Presign failed (${response.status}): ${body}`);
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
      const body = await response.text().catch(() => "");
      throw new Error(`S3 upload failed (${response.status}): ${body}`);
    }

    onProgress?.(100);
  } catch (err) {
    if (err instanceof VibeError) throw err;
    throw uploadFailed("S3 upload", err);
  }

  // Step 3: Confirm upload
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: presign.uploadId }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Confirm failed (${response.status}): ${body}`);
    }

    return { uploadId: presign.uploadId };
  } catch (err) {
    if (err instanceof VibeError) throw err;
    throw uploadFailed("confirm", err);
  }
}

/**
 * Check if the upload backend is configured and reachable.
 */
export async function isBackendAvailable(): Promise<boolean> {
  if (!API_BASE_URL || isDefaultApiUrl) {
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
