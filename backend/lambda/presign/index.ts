import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ok, badRequest, serverError } from "../shared/response";
import { notifyUploadEvent } from "../shared/notify";
import type { UploadRecord } from "../shared/types";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const UPLOAD_PREFIX = process.env.UPLOAD_PREFIX ?? "uploads/";
const PRESIGN_EXPIRY = Number(process.env.PRESIGN_EXPIRY_SECONDS ?? "300");
const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

interface PresignRequest {
  filename?: string;
  sizeBytes?: number;
  contentType?: string;
  userEmail?: string;
  userName?: string;
  repoUrl?: string;
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const body: PresignRequest = JSON.parse(event.body ?? "{}");

    // ─── Validation ───
    if (!body.filename || typeof body.filename !== "string") {
      return badRequest("filename is required");
    }
    if (!body.sizeBytes || typeof body.sizeBytes !== "number" || body.sizeBytes <= 0) {
      return badRequest("sizeBytes must be a positive number");
    }
    if (body.sizeBytes > MAX_SIZE_BYTES) {
      return badRequest(`sizeBytes exceeds maximum of ${MAX_SIZE_BYTES} bytes (5 GB)`);
    }
    if (body.contentType !== "application/zip") {
      return badRequest('contentType must be "application/zip"');
    }

    // Sanitize filename: strip path separators, limit length
    const sanitizedFilename = body.filename
      .replace(/[/\\]/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 255);

    const uploadId = randomUUID();
    const s3Key = `${UPLOAD_PREFIX}${uploadId}/${sanitizedFilename}`;

    // ─── Generate presigned URL ───
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: "application/zip",
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGN_EXPIRY,
    });

    // ─── Write to DynamoDB ───
    const sourceIp = event.requestContext?.http?.sourceIp ?? "unknown";

    const record: UploadRecord = {
      uploadId,
      status: "pending",
      filename: sanitizedFilename,
      sizeBytes: body.sizeBytes,
      contentType: body.contentType,
      s3Key,
      sourceIp,
      createdAt: new Date().toISOString(),
      ...(body.userEmail && { userEmail: body.userEmail.slice(0, 320) }),
      ...(body.userName && { userName: body.userName.slice(0, 200) }),
      ...(body.repoUrl && { repoUrl: body.repoUrl.slice(0, 500) }),
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: record,
      })
    );

    await notifyUploadEvent({
      eventType: "presign",
      uploadId,
      filename: sanitizedFilename,
      sizeMB: (body.sizeBytes / 1024 / 1024).toFixed(1),
      userName: body.userName,
      userEmail: body.userEmail,
      repoUrl: body.repoUrl,
      sourceIp,
    });

    return ok({ uploadUrl, uploadId });
  } catch (err) {
    console.error("Presign error:", err);
    if (err instanceof SyntaxError) {
      return badRequest("Invalid JSON body");
    }
    return serverError("Internal server error");
  }
}
