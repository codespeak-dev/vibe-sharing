/**
 * Upload a bundle Blob to the vibe-sharing server.
 * Mirrors the CLI upload flow: presign → PUT to S3 → confirm.
 */

const API_BASE_URL = "https://vibe-share.codespeak.dev";

export interface UploadMetadata {
  userEmail?: string;
  userName?: string;
  repoUrl?: string;
}

export interface UploadResult {
  uploadId: string;
}

type UploadPhase = "presign" | "upload" | "confirm";

export async function uploadBundle(
  blob: Blob,
  filename: string,
  metadata?: UploadMetadata,
  onPhase?: (phase: UploadPhase) => void,
): Promise<UploadResult> {
  // Step 1: Get presigned S3 URL
  onPhase?.("presign");
  const presignResp = await fetch(`${API_BASE_URL}/api/v1/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      sizeBytes: blob.size,
      contentType: "application/zip",
      ...(metadata?.userEmail ? { userEmail: metadata.userEmail } : {}),
      ...(metadata?.userName ? { userName: metadata.userName } : {}),
      ...(metadata?.repoUrl ? { repoUrl: metadata.repoUrl } : {}),
    }),
  });
  if (!presignResp.ok) {
    const body = await presignResp.text().catch(() => "");
    throw new Error(`Presign failed (${presignResp.status}): ${body}`);
  }
  const { uploadUrl, uploadId } = (await presignResp.json()) as {
    uploadUrl: string;
    uploadId: string;
  };

  // Step 2: PUT raw blob to S3
  onPhase?.("upload");
  const s3Resp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(blob.size),
    },
    body: blob,
  });
  if (!s3Resp.ok) {
    const body = await s3Resp.text().catch(() => "");
    throw new Error(`S3 upload failed (${s3Resp.status}): ${body}`);
  }

  // Step 3: Confirm with backend
  onPhase?.("confirm");
  const confirmResp = await fetch(`${API_BASE_URL}/api/v1/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  if (!confirmResp.ok) {
    const body = await confirmResp.text().catch(() => "");
    throw new Error(`Confirm failed (${confirmResp.status}): ${body}`);
  }

  return { uploadId };
}
