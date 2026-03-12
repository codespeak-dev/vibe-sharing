import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ok, badRequest, notFound, serverError } from "../shared/response";
import { notifyUploadEvent } from "../shared/notify";
import type { UploadRecord } from "../shared/types";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const DOWNLOAD_URL_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const body = JSON.parse(event.body ?? "{}");

    if (!body.uploadId || typeof body.uploadId !== "string") {
      return badRequest("uploadId is required");
    }

    // ─── Get record from DynamoDB ───
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { uploadId: body.uploadId },
      })
    );

    if (!Item) {
      return notFound("Upload not found");
    }

    const record = Item as UploadRecord;

    // Idempotent: if already confirmed, return a fresh presigned URL
    if (record.status === "confirmed") {
      return ok({ shareUrl: await buildDownloadUrl(record.s3Key, record.filename) });
    }

    // ─── Verify S3 object exists ───
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: record.s3Key,
        })
      );
    } catch (s3Err) {
      console.error("HeadObject failed:", s3Err);
      await notifyUploadEvent(
        "Upload failed",
        `File not found in S3\nUpload ID: ${record.uploadId}\nFile: ${record.filename}\nError: ${s3Err}`
      );
      return badRequest("File not uploaded yet");
    }

    // ─── Update status to confirmed ───
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { uploadId: body.uploadId },
        UpdateExpression: "SET #status = :confirmed, confirmedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":confirmed": "confirmed",
          ":now": new Date().toISOString(),
        },
      })
    );

    const shareUrl = await buildDownloadUrl(record.s3Key, record.filename);

    const sizeMB = (record.sizeBytes / 1024 / 1024).toFixed(1);
    await notifyUploadEvent(
      "Upload confirmed",
      `File: ${record.filename} (${sizeMB} MB)\nUpload ID: ${record.uploadId}`
    );

    return ok({ shareUrl });
  } catch (err) {
    console.error("Confirm error:", err);
    if (err instanceof SyntaxError) {
      return badRequest("Invalid JSON body");
    }
    return serverError("Internal server error");
  }
}

async function buildDownloadUrl(s3Key: string, filename: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_EXPIRY });
}
