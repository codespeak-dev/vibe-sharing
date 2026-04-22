import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ok, badRequest, notFound, serverError } from "../../shared/response";
import { requireApiKey } from "../shared/auth";

const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const ITEM_PREFIX = process.env.ITEM_PREFIX ?? "items/";
const DOWNLOAD_URL_EXPIRY = 60 * 60; // 1 hour

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const auth = await requireApiKey(event);
  if (auth) return auth;

  const itemId = event.pathParameters?.itemId;
  if (!itemId || !UUID_RE.test(itemId)) {
    return badRequest("itemId must be a UUID");
  }

  const prefix = `${ITEM_PREFIX}${itemId}/`;
  const manifestKey = `${prefix}manifest.json`;

  try {
    let manifest: Record<string, unknown>;
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET_NAME, Key: manifestKey })
      );
      const body = await obj.Body?.transformToString();
      if (!body) return notFound("Item not found");
      manifest = JSON.parse(body) as Record<string, unknown>;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === "NoSuchKey" || name === "NotFound") {
        return notFound("Item not found");
      }
      throw err;
    }

    const meta = manifest._meta as { filename?: string } | undefined;
    const filename = meta?.filename;
    if (!filename) return notFound("Item manifest has no filename");

    const fileKey = `${prefix}${filename}`;
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: DOWNLOAD_URL_EXPIRY }
    );

    return ok({ itemId, filename, downloadUrl, manifest });
  } catch (err) {
    console.error("Download testdata error:", err);
    return serverError("Internal server error");
  }
}
