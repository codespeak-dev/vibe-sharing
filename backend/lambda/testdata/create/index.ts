import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
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

    // Delete older items with the same manifest.id (overwrite semantics)
    const incomingId = typeof body.manifest?.id === "string" ? body.manifest.id : null;
    if (incomingId) {
      await deleteStaleItems(incomingId, itemId);
    }

    return ok({ itemId, uploadUrl, key: itemKey });
  } catch (err) {
    console.error("Create testdata error:", err);
    if (err instanceof SyntaxError) {
      return badRequest("Invalid JSON body");
    }
    return serverError("Internal server error");
  }
}

async function deleteStaleItems(incomingId: string, skipItemId: string): Promise<void> {
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: ITEM_PREFIX, Delimiter: "/" })
  );

  const prefixes = (listed.CommonPrefixes ?? [])
    .map((p) => p.Prefix)
    .filter((p): p is string => Boolean(p));

  for (const prefix of prefixes) {
    const existingItemId = prefix.slice(ITEM_PREFIX.length).replace(/\/$/, "");
    if (!existingItemId || existingItemId === skipItemId) continue;

    const manifestKey = `${prefix}manifest.json`;
    let existingCaseId: string | null = null;
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: manifestKey }));
      const body = await obj.Body?.transformToString();
      if (body) {
        const m = JSON.parse(body) as Record<string, unknown>;
        existingCaseId = typeof m.id === "string" ? m.id : null;
      }
    } catch {
      continue;
    }

    if (existingCaseId !== incomingId) continue;

    const objects = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix })
    );
    const toDelete = (objects.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (toDelete.length === 0) continue;

    await s3.send(
      new DeleteObjectsCommand({ Bucket: BUCKET_NAME, Delete: { Objects: toDelete, Quiet: true } })
    );
    console.log(`Deleted stale item ${existingItemId} (id=${incomingId})`);
  }
}
