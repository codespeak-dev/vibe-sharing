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
  ssmMock.on(GetParameterCommand).callsFake((input) => {
    if (input.Name === "/vibe-share/slack-bot-token") {
      return { Parameter: { Value: "xoxb-test-token" } };
    }
    return { Parameter: { Value: "C012345" } };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feature: Slack Notifications — Enriched Messages and Threaded Replies", () => {
  test("Slack notification shows user context in top-level message (name, email, repo URL)", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000300" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [snsRecord({
        Subject: "New upload requested",
        Message: JSON.stringify({
          eventType: "presign",
          uploadId: "u-3",
          filename: "x.zip",
          sizeMB: "2.5",
          userName: "Ting",
          userEmail: "ting@codespeak.dev",
          repoUrl: "https://github.com/codespeak-dev/vibe-sharing",
        }),
      })],
    });

    const topLevel = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(topLevel.text).toContain("Ting");
    expect(topLevel.text).toContain("ting@codespeak.dev");
    expect(topLevel.text).toContain("https://github.com/codespeak-dev/vibe-sharing");
  });

  test("Stage updates posted as threaded replies under the original Slack message", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000400" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [snsRecord({
        Subject: "New upload requested",
        Message: JSON.stringify({
          eventType: "presign",
          uploadId: "u-4",
          filename: "x.zip",
          sizeMB: "1.0",
          userEmail: "a@b.c",
        }),
      })],
    });

    // Two postMessage calls: top-level (no thread_ts) and reply (with thread_ts).
    expect(fetchMock.mock.calls.length).toBe(2);
    const topLevel = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const reply = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(topLevel.thread_ts).toBeUndefined();
    expect(reply.thread_ts).toBe("1700000000.000400");
  });

  test("Download link appended to top-level message on completion (chat.update with admin URL)", async () => {
    // Existing thread record with threadTs already set (winner has posted).
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === "threads") {
        return {
          Item: {
            groupKey: "u-5",
            threadTs: "1700000000.000500",
            channel: "C012345",
            topLevelText: "*Anonymous*\nUpload: x.zip (1.0 MB)",
          },
        };
      }
      return { Item: undefined };
    });
    ddbMock.on(UpdateCommand).resolves({});

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000600" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [snsRecord({
        Subject: "Upload confirmed",
        Message: JSON.stringify({
          eventType: "confirm",
          uploadId: "u-5",
          filename: "x.zip",
          sizeMB: "1.0",
        }),
      })],
    });

    // chat.update is called with text containing the download link
    const updateCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("chat.update"),
    );
    expect(updateCall).toBeDefined();
    const body = JSON.parse(updateCall![1].body as string);
    expect(body.text).toContain("admin.vibe-share.codespeak.dev/?download=u-5");
    expect(body.text).toContain("Download x.zip");
  });

  test("Lambda invalidates cached Slack token on error: token_revoked clears the cache so the next chat.postMessage refetches from SSM", async () => {
    // Reset module state so cachedBotToken starts fresh.
    vi.resetModules();
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    let getParameterCalls = 0;
    ssmMock.reset();
    ssmMock.on(GetParameterCommand).callsFake((input) => {
      if (input.Name === "/vibe-share/slack-bot-token") {
        getParameterCalls++;
        return { Parameter: { Value: `xoxb-token-${getParameterCalls}` } };
      }
      return { Parameter: { Value: "C012345" } };
    });

    // First Slack call returns token_revoked; subsequent succeed.
    let fetchCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      fetchCount++;
      if (fetchCount === 1) {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: false, error: "token_revoked" }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true, ts: "1700000000.000700" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");

    // Upload-event message: handler tries slackPostMessage in handleUploadEvent first
    // (token_revoked → cache invalidated → throws), the outer try/catch swallows it,
    // and handleAlarmMessage falls through to a plain-text post that re-fetches the token.
    await handler({
      Records: [snsRecord({
        Subject: "x",
        Message: JSON.stringify({
          eventType: "presign",
          uploadId: "u-cache-invalidation",
          filename: "x.zip",
          sizeMB: "1.0",
        }),
      })],
    });

    // First call to getBotToken populates the cache; token_revoked invalidates it;
    // the next chat.postMessage triggers a second SSM read.
    expect(getParameterCalls).toBeGreaterThanOrEqual(2);
  });

  test("Upload notifications: human-readable top-level + simple thread reply", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000800" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [snsRecord({
        Subject: "New upload requested",
        Message: JSON.stringify({
          eventType: "presign",
          uploadId: "u-8",
          filename: "thing.zip",
          sizeMB: "12.3",
          userName: "Bob",
          userEmail: "bob@a.b",
        }),
      })],
    });

    const top = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(top.text).toMatch(/Upload: thing\.zip \(12\.3 MB\)/);
    expect(top.text).not.toContain("```"); // top-level is plain text, no JSON
  });

  test("CloudWatch alarm notifications: human-readable top-level + JSON in thread reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.000900" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [snsRecord({
        Subject: "ALARM: \"Foo\"",
        Message: JSON.stringify({
          AlarmName: "PresignErrorAlarm",
          AlarmDescription: "Presign Lambda error rate exceeded",
          NewStateValue: "ALARM",
          NewStateReason: "Threshold crossed",
          StateChangeTime: "2026-01-01T00:00:00Z",
          Region: "eu-north-1",
        }),
      })],
    });

    expect(fetchMock.mock.calls.length).toBe(2);
    const top = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const thread = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(top.text).toMatch(/:rotating_light:/);
    expect(top.text).toContain("Presign Lambda error rate exceeded");
    expect(thread.thread_ts).toBe("1700000000.000900");
    expect(thread.text).toContain("```");
    expect(thread.text).toContain("PresignErrorAlarm");
  });

  test("Each upload creates its own independent Slack thread (groupKey == uploadId)", async () => {
    // Two different uploads → two different group keys in the threads table.
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const seenGroupKeys = new Set<string>();
    ddbMock.on(PutCommand).callsFake((input) => {
      if (input.TableName === "threads") {
        seenGroupKeys.add(input.Item!.groupKey as string);
      }
      return {};
    });
    ddbMock.on(UpdateCommand).resolves({});

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, ts: "1700000000.001000" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handler } = await import("../../backend/lambda/slack-notify/index.js");
    await handler({
      Records: [
        snsRecord({
          Subject: "x",
          Message: JSON.stringify({
            eventType: "presign",
            uploadId: "u-100",
            filename: "a.zip",
            sizeMB: "1",
          }),
        }),
        snsRecord({
          Subject: "x",
          Message: JSON.stringify({
            eventType: "presign",
            uploadId: "u-101",
            filename: "b.zip",
            sizeMB: "1",
          }),
        }),
      ],
    });

    expect(seenGroupKeys.has("u-100")).toBe(true);
    expect(seenGroupKeys.has("u-101")).toBe(true);
  });

  test.skip(
    "Clicking the download link prompts authentication then starts download: requires real Cognito + browser",
  );
  test.skip(
    "Email alert sent when Slack notification fails: requires SES + dead-letter integration",
  );
});

function snsRecord(opts: { Subject: string; Message: string }) {
  return {
    EventSource: "aws:sns",
    EventVersion: "1.0",
    EventSubscriptionArn: "arn",
    Sns: {
      Type: "Notification",
      MessageId: "m" + Math.random(),
      TopicArn: "arn:topic",
      Subject: opts.Subject,
      Message: opts.Message,
      Timestamp: "2026-01-01T00:00:00Z",
      SignatureVersion: "1",
      Signature: "x",
      SigningCertUrl: "x",
      UnsubscribeUrl: "x",
      MessageAttributes: {},
    },
  } as const;
}
