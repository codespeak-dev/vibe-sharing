import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const ssmMock = mockClient(SSMClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeAll(() => {
  process.env.SLACK_BOT_TOKEN_SSM_PARAM = "/vibe-share/slack-bot-token";
  process.env.SLACK_CHANNEL_ID_SSM_PARAM = "/vibe-share/slack-channel-id";
  process.env.SLACK_THREADS_TABLE_NAME = "threads";
  process.env.INTERNAL_EMAILS_TABLE_NAME = "internal-emails";
  process.env.ADMIN_UI_URL = "https://admin.vibe-share.codespeak.dev";
  process.env.AWS_REGION = "eu-north-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
});

beforeEach(() => {
  ssmMock.reset();
  ddbMock.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feature: Slack Notifications — Internal User Distinction", () => {
  test("Display :codespeak: emoji prefix for internal user uploads (classified via InternalEmailsTable)", async () => {
    ssmMock.on(GetParameterCommand).callsFake((input) => {
      if (input.Name === "/vibe-share/slack-bot-token") {
        return { Parameter: { Value: "xoxb-test-token" } };
      }
      return { Parameter: { Value: "C012345" } };
    });

    // GetCommand on internal-emails table → email present (=> internal user)
    // GetCommand on threads table → no existing thread
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === "internal-emails") {
        return { Item: { email: "ting@codespeak.dev" } };
      }
      return { Item: undefined };
    });
    ddbMock.on(PutCommand).resolves({}); // claim thread
    ddbMock.on(UpdateCommand).resolves({}); // setThreadTs

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000100" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [
        {
          EventSource: "aws:sns",
          EventVersion: "1.0",
          EventSubscriptionArn: "arn",
          Sns: {
            Type: "Notification",
            MessageId: "m1",
            TopicArn: "arn:topic",
            Subject: "New upload requested",
            Message: JSON.stringify({
              eventType: "presign",
              uploadId: "u-1",
              filename: "archive.zip",
              sizeMB: "1.0",
              userName: "Ting",
              userEmail: "ting@codespeak.dev",
              repoUrl: "https://github.com/codespeak-dev/vibe-sharing",
              sourceIp: "1.2.3.4",
            }),
            Timestamp: "2026-01-01T00:00:00Z",
            SignatureVersion: "1",
            Signature: "x",
            SigningCertUrl: "x",
            UnsubscribeUrl: "x",
            MessageAttributes: {},
          },
        },
      ],
    });

    // First chat.postMessage call posts the top-level thread message;
    // assert it includes :codespeak: prefix because the user is internal.
    expect(fetchMock).toHaveBeenCalled();
    const firstCallBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(firstCallBody.text).toMatch(/:codespeak:/);
  });

  test("External user upload does NOT get the :codespeak: prefix", async () => {
    ssmMock.on(GetParameterCommand).callsFake((input) => {
      if (input.Name === "/vibe-share/slack-bot-token") {
        return { Parameter: { Value: "xoxb-test-token" } };
      }
      return { Parameter: { Value: "C012345" } };
    });

    ddbMock.on(GetCommand).resolves({ Item: undefined }); // not internal, no thread
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000200" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [
        {
          EventSource: "aws:sns",
          EventVersion: "1.0",
          EventSubscriptionArn: "arn",
          Sns: {
            Type: "Notification",
            MessageId: "m2",
            TopicArn: "arn:topic",
            Subject: "New upload requested",
            Message: JSON.stringify({
              eventType: "presign",
              uploadId: "u-2",
              filename: "archive.zip",
              sizeMB: "1.0",
              userEmail: "ext@example.com",
            }),
            Timestamp: "2026-01-01T00:00:00Z",
            SignatureVersion: "1",
            Signature: "x",
            SigningCertUrl: "x",
            UnsubscribeUrl: "x",
            MessageAttributes: {},
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalled();
    const firstCallBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(firstCallBody.text).not.toMatch(/:codespeak:/);
  });
});
