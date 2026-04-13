import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ok, badRequest, notFound, serverError } from "../shared/response";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const MAX_NOTES_LENGTH = 2000;

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const uploadId = event.pathParameters?.uploadId;
    if (!uploadId) return badRequest("Missing uploadId");

    const body = JSON.parse(event.body || "{}");
    if (typeof body.notes !== "string") return badRequest("notes must be a string");
    if (body.notes.length > MAX_NOTES_LENGTH) return badRequest(`notes must be at most ${MAX_NOTES_LENGTH} characters`);

    const notes = body.notes.trim();

    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { uploadId },
        UpdateExpression: "SET notes = :notes",
        ConditionExpression: "attribute_exists(uploadId)",
        ExpressionAttributeValues: { ":notes": notes },
        ReturnValues: "ALL_NEW",
      })
    );

    return ok({ uploadId, notes: result.Attributes?.notes });
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      return notFound("Upload not found");
    }
    console.error("UpdateUpload error:", err);
    return serverError("Internal server error");
  }
}
