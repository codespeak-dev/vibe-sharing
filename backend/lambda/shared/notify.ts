import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});
const TOPIC_ARN = process.env.UPLOAD_EVENTS_TOPIC_ARN;

export interface UploadEvent {
  eventType: "presign" | "confirm" | "confirm-failed";
  uploadId: string;
  filename: string;
  sizeMB: string;
  userName?: string;
  userEmail?: string;
  repoUrl?: string;
  sourceIp?: string;
  error?: string;
}

const SUBJECT_MAP: Record<UploadEvent["eventType"], string> = {
  presign: "New upload requested",
  confirm: "Upload confirmed",
  "confirm-failed": "Upload failed",
};

/**
 * Publish a structured upload event to SNS (fire-and-forget).
 * Never throws — failures are logged but don't affect the API response.
 */
export async function notifyUploadEvent(event: UploadEvent): Promise<void> {
  if (!TOPIC_ARN) return;
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        Subject: SUBJECT_MAP[event.eventType],
        Message: JSON.stringify(event),
      })
    );
  } catch (err) {
    console.error("Failed to publish upload event:", err);
  }
}
