import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ok, badRequest, serverError } from "../shared/response";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.INTERNAL_EMAILS_TABLE_NAME!;

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;

  try {
    if (method === "GET") {
      return handleList();
    } else if (method === "POST") {
      return handleAdd(event);
    } else if (method === "DELETE") {
      return handleRemove(event);
    }
    return badRequest("Unsupported method");
  } catch (err) {
    console.error("InternalEmails error:", err);
    if (err instanceof SyntaxError) return badRequest("Invalid JSON body");
    return serverError("Internal server error");
  }
}

async function handleList(): Promise<APIGatewayProxyResultV2> {
  const { Items = [] } = await ddb.send(
    new ScanCommand({ TableName: TABLE_NAME })
  );
  const emails = Items.map((item) => item.email as string).sort();
  return ok({ emails });
}

async function handleAdd(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const email = parseEmail(event);
  if (!email) return badRequest("Missing or invalid email");

  await ddb.send(
    new PutCommand({ TableName: TABLE_NAME, Item: { email } })
  );
  return ok({ email });
}

async function handleRemove(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const email = parseEmail(event);
  if (!email) return badRequest("Missing or invalid email");

  await ddb.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { email } })
  );
  return ok({ email });
}

function parseEmail(event: APIGatewayProxyEventV2): string | null {
  if (!event.body) return null;
  const body = JSON.parse(event.body);
  const raw = body.email;
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}
