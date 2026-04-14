import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ok, badRequest, notFound, serverError } from "../shared/response";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

const ALLOWED_FIELDS: Record<string, number> = {
  userEmail: 320,
  userName: 200,
  repoUrl: 500,
  notes: 2000,
};

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const uploadId = event.pathParameters?.uploadId;
    if (!uploadId) return badRequest("Missing uploadId");

    const body = JSON.parse(event.body || "{}");

    // Build SET and REMOVE clauses from allowed fields
    const setExprs: string[] = [];
    const removeExprs: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, string> = {};

    for (const [field, maxLen] of Object.entries(ALLOWED_FIELDS)) {
      if (!(field in body)) continue;

      const val = body[field];
      if (val !== null && val !== undefined && typeof val !== "string") {
        return badRequest(`${field} must be a string or null`);
      }

      names[`#${field}`] = field;

      if (val === null || val === undefined || val === "") {
        removeExprs.push(`#${field}`);
      } else {
        const trimmed = val.slice(0, maxLen);
        setExprs.push(`#${field} = :${field}`);
        values[`:${field}`] = trimmed;
      }
    }

    // Boolean fields
    if ("unusable" in body) {
      names["#unusable"] = "unusable";
      if (body.unusable) {
        setExprs.push("#unusable = :unusable");
        values[":unusable"] = true as any;
      } else {
        removeExprs.push("#unusable");
      }
    }

    if (setExprs.length === 0 && removeExprs.length === 0) {
      return badRequest("No valid fields to update");
    }

    let updateExpression = "";
    if (setExprs.length > 0) updateExpression += "SET " + setExprs.join(", ");
    if (removeExprs.length > 0) updateExpression += " REMOVE " + removeExprs.join(", ");

    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { uploadId },
        UpdateExpression: updateExpression.trim(),
        ConditionExpression: "attribute_exists(uploadId)",
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values }),
        ReturnValues: "ALL_NEW",
      })
    );

    return ok({ uploadId, updated: result.Attributes });
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      return notFound("Upload not found");
    }
    if (err instanceof SyntaxError) return badRequest("Invalid JSON body");
    console.error("UpdateUpload error:", err);
    return serverError("Internal server error");
  }
}
