import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Build a minimal API Gateway HTTP API v2 event for handler unit tests.
 */
export function makeApiEvent(opts: {
  method?: string;
  path?: string;
  body?: unknown;
  sourceIp?: string;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${opts.method ?? "POST"} ${opts.path ?? "/"}`,
    rawPath: opts.path ?? "/",
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      accountId: "111111111111",
      apiId: "api",
      domainName: "example.com",
      domainPrefix: "x",
      http: {
        method: opts.method ?? "POST",
        path: opts.path ?? "/",
        protocol: "HTTP/1.1",
        sourceIp: opts.sourceIp ?? "127.0.0.1",
        userAgent: "test",
      },
      requestId: "rq-1",
      routeKey: `${opts.method ?? "POST"} ${opts.path ?? "/"}`,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
  };
}

/** Parse a JSON body from a handler result. */
export function parseBody<T = unknown>(result: unknown): T {
  if (typeof result === "object" && result !== null && "body" in result) {
    const body = (result as { body?: string }).body;
    return body ? (JSON.parse(body) as T) : ({} as T);
  }
  throw new Error(`Unexpected handler result: ${JSON.stringify(result)}`);
}

/** Read statusCode from a handler result. */
export function statusOf(result: unknown): number {
  if (typeof result === "object" && result !== null && "statusCode" in result) {
    return (result as { statusCode: number }).statusCode;
  }
  throw new Error(`Unexpected handler result: ${JSON.stringify(result)}`);
}
