import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { badRequest, notFound, serverError } from "../../shared/response";
import { requireApiKey } from "../shared/auth";

const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const ITEM_PREFIX = process.env.ITEM_PREFIX ?? "items/";

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

  try {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix })
    );

    const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (objects.length === 0) {
      return notFound("Item not found");
    }

    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: { Objects: objects, Quiet: true },
      })
    );

    return { statusCode: 204, body: "" };
  } catch (err) {
    console.error("Delete testdata error:", err);
    return serverError("Internal server error");
  }
}
