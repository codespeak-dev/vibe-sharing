import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ok, serverError } from "../shared/response";
import type { UploadRecord } from "../shared/types";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const DOWNLOAD_URL_EXPIRY = 60 * 60; // 1 hour

export async function handler(
  _event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const { Items = [] } = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "#status = :confirmed",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":confirmed": "confirmed" },
      })
    );

    const records = Items as UploadRecord[];
    records.sort(
      (a, b) =>
        new Date(b.confirmedAt ?? b.createdAt).getTime() -
        new Date(a.confirmedAt ?? a.createdAt).getTime()
    );

    const uploads = await Promise.all(
      records.map(async (r) => ({
        uploadId: r.uploadId,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt,
        confirmedAt: r.confirmedAt,
        userName: r.userName,
        userEmail: r.userEmail,
        repoUrl: r.repoUrl,
        notes: r.notes,
        downloadUrl: await buildDownloadUrl(r.s3Key, r.filename),
      }))
    );

    return ok({ uploads });
  } catch (err) {
    console.error("ListUploads error:", err);
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
