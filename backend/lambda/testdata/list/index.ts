import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ok, serverError } from "../../shared/response";
import { requireApiKey } from "../shared/auth";

const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const ITEM_PREFIX = process.env.ITEM_PREFIX ?? "items/";
const DOWNLOAD_URL_EXPIRY = 60 * 60; // 1 hour

interface ListedItem {
  itemId: string;
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
  manifest: Record<string, unknown> | null;
  downloadUrl: string | null;
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const auth = await requireApiKey(event);
  if (auth) return auth;

  const qs = event.queryStringParameters ?? {};
  const limitRaw = Number(qs.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 1000
      ? Math.floor(limitRaw)
      : 100;
  const cursor = qs.cursor || undefined;

  try {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: ITEM_PREFIX,
        Delimiter: "/",
        MaxKeys: limit,
        ContinuationToken: cursor,
      })
    );

    const prefixes = (listed.CommonPrefixes ?? [])
      .map((p) => p.Prefix)
      .filter((p): p is string => Boolean(p));

    const items = await Promise.all(
      prefixes.map((prefix) => loadItem(prefix))
    );

    return ok({
      items: items.filter((i): i is ListedItem => i !== null),
      nextCursor: listed.IsTruncated ? listed.NextContinuationToken ?? null : null,
    });
  } catch (err) {
    console.error("List testdata error:", err);
    return serverError("Internal server error");
  }
}

async function loadItem(prefix: string): Promise<ListedItem | null> {
  // prefix looks like "items/{itemId}/"
  const itemId = prefix.slice(ITEM_PREFIX.length).replace(/\/$/, "");
  if (!itemId) return null;

  const manifestKey = `${prefix}manifest.json`;

  let manifest: Record<string, unknown> | null = null;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: manifestKey })
    );
    const body = await obj.Body?.transformToString();
    if (body) {
      manifest = JSON.parse(body) as Record<string, unknown>;
    }
  } catch (err) {
    // Manifest missing or unreadable — return item stub without it.
    console.warn(`Failed to read manifest for ${itemId}:`, err);
  }

  const meta = (manifest?._meta ?? null) as
    | { filename?: string; sizeBytes?: number; createdAt?: string }
    | null;

  let downloadUrl: string | null = null;
  if (meta?.filename) {
    const fileKey = `${prefix}${meta.filename}`;
    downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        ResponseContentDisposition: `attachment; filename="${meta.filename}"`,
      }),
      { expiresIn: DOWNLOAD_URL_EXPIRY }
    );
  }

  return {
    itemId,
    filename: meta?.filename ?? null,
    sizeBytes: meta?.sizeBytes ?? null,
    createdAt: meta?.createdAt ?? null,
    manifest,
    downloadUrl,
  };
}
