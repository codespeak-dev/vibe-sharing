import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feature: Backend Infrastructure — AWS CDK", () => {
  test("Deploy and manage backend from the command line: stack synthesizes a CloudFormation template", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });

  test("Upload files up to 5GB via presigned URL flow: S3 bucket configured for presigned PUT-only uploads with public access blocked", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
          }),
        ]),
      }),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test("Submit optional reporter metadata: presign API route exists and accepts POST", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /api/v1/presign",
    });
  });

  test("Submit optional reporter metadata: presign handler stores email/name/repoUrl alongside the upload record", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    snsMock.on(PublishCommand).resolves({});

    const { handler } = await import("../../backend/lambda/presign/index.js");
    await handler(
      makeApiEvent({
        path: "/api/v1/presign",
        body: {
          filename: "archive.zip",
          sizeBytes: 1024,
          contentType: "application/zip",
          userEmail: "ting@codespeak.dev",
          userName: "Ting",
          repoUrl: "https://github.com/codespeak-dev/vibe-sharing",
        },
      }),
    );

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls.length).toBe(1);
    const item = putCalls[0]!.args[0]!.input.Item!;
    expect(item.userEmail).toBe("ting@codespeak.dev");
    expect(item.userName).toBe("Ting");
    expect(item.repoUrl).toBe("https://github.com/codespeak-dev/vibe-sharing");
    expect(item.status).toBe("pending");
  });

  test("Upload events publish to SNS so Slack/email subscribers receive them", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    snsMock.on(PublishCommand).resolves({});

    const { handler } = await import("../../backend/lambda/presign/index.js");
    await handler(
      makeApiEvent({
        path: "/api/v1/presign",
        body: {
          filename: "x.zip",
          sizeBytes: 1024,
          contentType: "application/zip",
        },
      }),
    );

    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls.length).toBe(1);
    const message = JSON.parse(calls[0]!.args[0]!.input.Message!);
    expect(message.eventType).toBe("presign");
  });

  test("Reject upload over 5GB", async () => {
    const { handler } = await import("../../backend/lambda/presign/index.js");
    const result = await handler(
      makeApiEvent({
        path: "/api/v1/presign",
        body: {
          filename: "huge.zip",
          sizeBytes: 6 * 1024 * 1024 * 1024,
          contentType: "application/zip",
        },
      }),
    );
    expect(statusOf(result)).toBe(400);
    expect(parseBody<{ error: string }>(result).error).toMatch(/5 GB/i);
  });

  test("Reject missing filename / non-positive size", async () => {
    const { handler } = await import("../../backend/lambda/presign/index.js");
    expect(
      statusOf(
        await handler(
          makeApiEvent({
            path: "/api/v1/presign",
            body: { sizeBytes: 1024, contentType: "application/zip" },
          }),
        ),
      ),
    ).toBe(400);
    expect(
      statusOf(
        await handler(
          makeApiEvent({
            path: "/api/v1/presign",
            body: { filename: "x.zip", sizeBytes: 0, contentType: "application/zip" },
          }),
        ),
      ),
    ).toBe(400);
  });

  test("API Gateway stage has throttling configured", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: {
        ThrottlingBurstLimit: 10,
        ThrottlingRateLimit: 5,
      },
    });
  });

  test.skip("Upload a real 5GB file end-to-end: requires deployed S3 bucket and live network");
  test.skip("Deploy and tear down backend using CDK CLI: requires real AWS account");
  test.skip("Install CDK dependencies and initialise a CDK project: one-shot setup");
  test.skip("Set up AWS credentials and bootstrap CDK: requires real AWS account");
  test.skip("Confirm SSO credentials are sufficient for CDK deployment: requires real AWS SSO");
  test.skip("Bootstrap CDK from a directory without cdk.json: assertion against CLI behavior, not synthesized template");
  test.skip("Copy plan file to the intent/app/ directory: documentation/setup task");
  test.skip("Read backend/README.md to understand setup and usage: documentation read");
  test.skip("Set VIBE_SHARING_API_URL to test against a custom backend: covered by upload.ts unit behavior; needs live backend to fully verify");
});
