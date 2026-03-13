import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ok, serverError } from "../shared/response";

interface SlackThreadRecord {
  groupKey: string;
  threadTs: string;
  channel: string;
  createdAt: string;
  expiresAt?: number;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.SLACK_THREADS_TABLE_NAME!;

export async function handler(
  _event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const { Items = [] } = await ddb.send(
      new ScanCommand({ TableName: TABLE_NAME })
    );

    const records = Items as SlackThreadRecord[];
    const threads = records
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .map((item) => ({
        groupKey: item.groupKey,
        threadTs: item.threadTs,
        channel: item.channel,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
      }));

    return ok({ threads });
  } catch (err) {
    console.error("ListSlackThreads error:", err);
    return serverError("Internal server error");
  }
}
