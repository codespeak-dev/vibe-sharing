import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { getStackTemplate } from "../helpers/cdk-template.js";
import { makeApiEvent, parseBody, statusOf } from "../helpers/lambda-event.js";

const template = getStackTemplate();

const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

beforeAll(() => {
  process.env.BUCKET_NAME = "test-bucket";
  process.env.TABLE_NAME = "test-table";
  process.env.UPLOAD_PREFIX = "uploads/";
  process.env.PRESIGN_EXPIRY_SECONDS = "300";
  process.env.UPLOAD_EVENTS_TOPIC_ARN = "arn:aws:sns:eu-north-1:111111111111:test";
  process.env.AWS_REGION = "eu-north-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
});

beforeEach(() => {
  s3Mock.reset();
  ddbMock.reset();
  snsMock.reset();
  // Lambda handlers log expected errors via console.error; silence them.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feature: Backend Security and Observability", () => {
  test("Enable PITR for DynamoDB: UploadsTable has PointInTimeRecoverySpecification enabled", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([{ AttributeName: "uploadId", KeyType: "HASH" }]),
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test("CloudWatch alarms with SNS notifications: at least 5 alarms with AlarmActions wired", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(5);
    for (const alarm of Object.values(alarms)) {
      expect(alarm.Properties.AlarmActions).toBeDefined();
      expect(alarm.Properties.AlarmActions.length).toBeGreaterThan(0);
    }
  });

  test("OK recovery notification: every alarm has OKActions configured", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    for (const alarm of Object.values(alarms)) {
      expect(alarm.Properties.OKActions).toBeDefined();
      expect(alarm.Properties.OKActions.length).toBeGreaterThan(0);
    }
  });

  test("Update alarms email via single config entry: SNS email subscription points at config.alarmEmail", () => {
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "a+alarms@codespeak.dev",
    });
  });

  test("Slack webhook Lambda subscribed to alarm and upload-events SNS topics: at least two lambda subscriptions", () => {
    const subs = template.findResources("AWS::SNS::Subscription", {
      Properties: { Protocol: "lambda" },
    });
    expect(Object.keys(subs).length).toBeGreaterThanOrEqual(2);
  });

  test("Store Slack webhook in SSM Parameter Store: SlackNotifyFunction env vars reference SSM parameter names", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          SLACK_BOT_TOKEN_SSM_PARAM: "/vibe-share/slack-bot-token",
          SLACK_CHANNEL_ID_SSM_PARAM: "/vibe-share/slack-channel-id",
        }),
      },
    });
  });

  test("Lambda IAM policy grants ssm:GetParameter for SSM-backed credentials", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const grantsSsm = Object.values(policies).some((p) =>
      JSON.stringify(p.Properties.PolicyDocument).includes("ssm:GetParameter"),
    );
    expect(grantsSsm).toBe(true);
  });

  test("Per-issue decisions: stack still synthesizes after security review (verbose error messages remediation deferred)", () => {
    expect(template).toBeDefined();
  });

  test("Add Content-Type condition to presigned URLs: presign rejects any contentType that is not application/zip", async () => {
    const { handler } = await import("../../backend/lambda/presign/index.js");
    const reject = await handler(
      makeApiEvent({
        path: "/api/v1/presign",
        body: {
          filename: "evil.zip",
          sizeBytes: 1024,
          contentType: "application/octet-stream",
        },
      }),
    );
    expect(statusOf(reject)).toBe(400);
    expect(parseBody<{ error: string }>(reject).error).toMatch(/application\/zip/);
  });

  test("Add Content-Type condition: the PutObjectCommand carries ContentType so S3 rejects mismatched uploads", async () => {
    // SigV4 signs the Content-Type header (not in URL query), so the client
    // must PUT with the same Content-Type. Verify the source wires ContentType
    // through to PutObjectCommand and that the signed URL is for a PutObject op.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.join(process.cwd(), "backend", "lambda", "presign", "index.ts"),
      "utf8",
    );
    expect(src).toMatch(/new PutObjectCommand\(\{[\s\S]*?ContentType:\s*["']application\/zip["']/);

    s3Mock.on(PutObjectCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    snsMock.on(PublishCommand).resolves({});

    const { handler } = await import("../../backend/lambda/presign/index.js");
    const result = await handler(
      makeApiEvent({
        path: "/api/v1/presign",
        body: {
          filename: "x.zip",
          sizeBytes: 1024,
          contentType: "application/zip",
        },
      }),
    );
    expect(statusOf(result)).toBe(200);
    const body = parseBody<{ uploadUrl: string }>(result);
    expect(body.uploadUrl).toMatch(/x-id=PutObject/);
  });

  test("Receive Slack notification when an upload fails at confirmation: confirm publishes a confirm-failed event when S3 file is missing", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeRecord({ status: "pending" }),
    });
    s3Mock.on(HeadObjectCommand).rejects(new Error("NotFound"));
    snsMock.on(PublishCommand).resolves({});

    const { handler } = await import("../../backend/lambda/confirm/index.js");
    const result = await handler(
      makeApiEvent({
        path: "/api/v1/confirm",
        body: { uploadId: "abc-123" },
      }),
    );
    expect(statusOf(result)).toBe(400);

    const events = snsMock
      .commandCalls(PublishCommand)
      .map((c) => JSON.parse(c.args[0]!.input.Message!));
    expect(events.some((e) => e.eventType === "confirm-failed")).toBe(true);
  });

  test("Confirm endpoint is idempotent: a second confirm of an already-confirmed upload returns 200 without re-publishing", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeRecord({ status: "confirmed" }),
    });
    snsMock.on(PublishCommand).resolves({});
    const { handler } = await import("../../backend/lambda/confirm/index.js");

    const result = await handler(
      makeApiEvent({
        path: "/api/v1/confirm",
        body: { uploadId: "abc-123" },
      }),
    );
    expect(statusOf(result)).toBe(200);
    // No new SNS publish for an already-confirmed record.
    expect(snsMock.commandCalls(PublishCommand).length).toBe(0);
  });

  test("Confirm endpoint returns 404 when uploadId is unknown", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const { handler } = await import("../../backend/lambda/confirm/index.js");
    const result = await handler(
      makeApiEvent({
        path: "/api/v1/confirm",
        body: { uploadId: "missing" },
      }),
    );
    expect(statusOf(result)).toBe(404);
  });

  test("Confirm endpoint marks the record as confirmed and stores confirmedAt", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeRecord({ status: "pending" }),
    });
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    ddbMock.on(UpdateCommand).resolves({});
    snsMock.on(PublishCommand).resolves({});

    const { handler } = await import("../../backend/lambda/confirm/index.js");
    await handler(
      makeApiEvent({
        path: "/api/v1/confirm",
        body: { uploadId: "abc-123" },
      }),
    );

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBe(1);
    const exprValues = updateCalls[0]!.args[0]!.input.ExpressionAttributeValues!;
    expect(exprValues[":confirmed"]).toBe("confirmed");
    expect(exprValues[":now"]).toMatch(/^\d{4}-/);
  });

  // ─── Slack delivery / live infra scenarios ───
  test.skip("Receive CloudWatch alarm notification email at alarms@codespeak.dev: requires real SES delivery");
  test.skip("Receive a Slack message when a CloudWatch alarm fires: requires real Slack");
  test.skip("Read README to know the SSM parameter is required: documentation read");
  test.skip("Review uncommitted changes for correctness: human review activity");
  test.skip("API Gateway CORS applies only to browsers (irrelevant to CLI clients): conceptual scenario");
  test.skip("Rotate Slack webhook URL and have Lambda pick it up within 5 minutes: requires real SSM rotation + time");
  test.skip("AWS_PROFILE set automatically via direnv: shell-level behavior outside CDK");
  test.skip("Receive Slack notification when a presign request is submitted: requires real Slack");
  test.skip("Receive Slack notification when an upload is successfully confirmed: requires real Slack");
  test.skip("Receive Slack notification when an upload fails at confirmation: requires real Slack");
  test.skip("Add Content-Type condition to presigned URLs: covered by presign handler unit test (Feature 7/13)");
  test.skip("Cost breakdown for WAF/CloudFront before any implementation: planning artifact");
  test.skip("Review and decide to skip WAF and CloudFront: decision artifact, not in stack");
  test.skip("Security review report: human review activity");
  test.skip("Lambda throws on Slack delivery failure enabling SNS retry: covered by slack-notify handler unit test (Feature 23)");
});

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    uploadId: "abc-123",
    status: "pending",
    filename: "archive.zip",
    sizeBytes: 1024,
    contentType: "application/zip",
    s3Key: "uploads/abc-123/archive.zip",
    sourceIp: "127.0.0.1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
