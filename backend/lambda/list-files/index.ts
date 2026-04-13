import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ok, badRequest, notFound, serverError } from "../shared/response";
import type { UploadRecord } from "../shared/types";
import { parseZipTail, parseEocd, parseFullCentralDirectory } from "./zip-parser";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

const TAIL_SIZE = 65_557; // 64KB + 22-byte EOCD + margin

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const uploadId = event.pathParameters?.uploadId;
    if (!uploadId) {
      return badRequest("Missing uploadId");
    }

    // 1. Get upload record
    const { Item } = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { uploadId } })
    );

    if (!Item) {
      return notFound("Upload not found");
    }

    const record = Item as UploadRecord;
    if (record.status !== "confirmed") {
      return notFound("Upload not confirmed");
    }

    // 2. Read the tail of the ZIP from S3
    const tailStart = Math.max(0, record.sizeBytes - TAIL_SIZE);
    const tailEnd = record.sizeBytes - 1;

    const tailResp = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: record.s3Key,
        Range: `bytes=${tailStart}-${tailEnd}`,
      })
    );

    const tailBuffer = Buffer.from(await tailResp.Body!.transformToByteArray());

    // 3. Parse the ZIP tail
    const result = parseZipTail(tailBuffer, tailStart);

    if (result.kind === "ok") {
      return ok({ files: result.entries });
    }

    if (result.kind === "error") {
      return badRequest(result.message);
    }

    // 4. Need more data: fetch the full central directory
    const eocd = parseEocd(tailBuffer, tailStart);
    if ("error" in eocd) {
      return badRequest(eocd.error);
    }

    const cdResp = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: record.s3Key,
        Range: `bytes=${result.cdOffset}-${result.cdOffset + result.cdSize - 1}`,
      })
    );

    const cdBuffer = Buffer.from(await cdResp.Body!.transformToByteArray());
    const fullResult = parseFullCentralDirectory(cdBuffer, eocd.totalEntries);

    if (fullResult.kind === "ok") {
      return ok({ files: fullResult.entries });
    }

    return badRequest(fullResult.kind === "error" ? fullResult.message : "Failed to parse archive");
  } catch (err) {
    console.error("ListFiles error:", err);
    return serverError("Internal server error");
  }
}
