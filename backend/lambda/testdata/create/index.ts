import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ok, badRequest, serverError } from "../../shared/response";
import { requireApiKey } from "../shared/auth";

const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const ITEM_PREFIX = process.env.ITEM_PREFIX ?? "items/";
const PRESIGN_EXPIRY = Number(process.env.PRESIGN_EXPIRY_SECONDS ?? "300");
const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

interface CreateRequest {
  filename?: string;
  sizeBytes?: number;
  contentType?: string;
  manifest?: Record<string, unknown>;
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const auth = await requireApiKey(event);
  if (auth) return auth;

  try {
    const body: CreateRequest = JSON.parse(event.body ?? "{}");

    if (!body.filename || typeof body.filename !== "string") {
      return badRequest("filename is required");
    }
    if (!body.sizeBytes || typeof body.sizeBytes !== "number" || body.sizeBytes <= 0) {
      return badRequest("sizeBytes must be a positive number");
    }
    if (body.sizeBytes > MAX_SIZE_BYTES) {
      return badRequest(`sizeBytes exceeds maximum of ${MAX_SIZE_BYTES} bytes (5 GB)`);
    }
    if (
      !body.manifest ||
      typeof body.manifest !== "object" ||
      Array.isArray(body.manifest)
    ) {
      return badRequest("manifest must be a JSON object");
    }

    const sanitizedFilename = body.filename
      .replace(/[/\\]/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 255);

    const contentType = body.contentType ?? "application/zip";

    const itemId = randomUUID();
    const itemKey = `${ITEM_PREFIX}${itemId}/${sanitizedFilename}`;
    const manifestKey = `${ITEM_PREFIX}${itemId}/manifest.json`;

    const manifest = {
      ...body.manifest,
      _meta: {
        itemId,
        filename: sanitizedFilename,
        sizeBytes: body.sizeBytes,
        contentType,
        createdAt: new Date().toISOString(),
      },
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: manifestKey,
        ContentType: "application/json",
        Body: JSON.stringify(manifest),
      })
    );

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: itemKey,
        ContentType: contentType,
      }),
      { expiresIn: PRESIGN_EXPIRY }
    );

    return ok({ itemId, uploadUrl, key: itemKey });
  } catch (err) {
    console.error("Create testdata error:", err);
    if (err instanceof SyntaxError) {
      return badRequest("Invalid JSON body");
    }
    return serverError("Internal server error");
  }
}
