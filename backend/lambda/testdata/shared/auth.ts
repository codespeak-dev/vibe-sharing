import { timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { serverError } from "../../shared/response";

const ssm = new SSMClient({});
const API_KEY_PARAM = process.env.API_KEY_SSM_PARAM!;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedApiKey: string | undefined;
let cachedAt = 0;

async function getApiKey(): Promise<string> {
  if (cachedApiKey && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedApiKey;
  }
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: API_KEY_PARAM, WithDecryption: true })
  );
  const value = Parameter?.Value;
  if (!value) throw new Error("Test data API key not found in SSM");
  cachedApiKey = value;
  cachedAt = Date.now();
  return value;
}

const UNAUTHORIZED: APIGatewayProxyResultV2 = {
  statusCode: 401,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: "Unauthorized" }),
};

export async function requireApiKey(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2 | null> {
  const headers = event.headers ?? {};
  const provided =
    headers["x-api-key"] ?? headers["X-Api-Key"] ?? headers["X-API-Key"];
  if (typeof provided !== "string" || provided.length === 0) {
    return UNAUTHORIZED;
  }
  let expected: string;
  try {
    expected = await getApiKey();
  } catch (err) {
    console.error("Failed to load API key from SSM:", err);
    return serverError("Auth configuration error");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return UNAUTHORIZED;
  }
  return null;
}
