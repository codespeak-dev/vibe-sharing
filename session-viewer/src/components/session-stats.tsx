import { formatDateTime, formatTime, formatDuration, formatBytes, isSameDate } from "@/lib/format";

export interface SessionStatsProps {
  messageCount?: number | null;
  userPromptCount?: number;
  created?: string | null;
  modified?: string | null;
  sizeBytes: number;
}

export function SessionStats({
  messageCount,
  userPromptCount,
  created,
  modified,
  sizeBytes,
}: SessionStatsProps) {
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500 flex-wrap">
      {messageCount != null && (
        <span>
          {messageCount} {messageCount === 1 ? "msg" : "msgs"}
          {userPromptCount != null && userPromptCount > 0 && (
            <> ({userPromptCount} {userPromptCount === 1 ? "prompt" : "prompts"})</>
          )}
        </span>
      )}
      {created && modified && created !== modified ? (
        isSameDate(created, modified) ? (
          <span>
            {formatDateTime(created)} &rarr; {formatTime(modified)} ({formatDuration(created, modified)})
          </span>
        ) : (
          <span>
            {formatDateTime(created)} &rarr; {formatDateTime(modified)} ({formatDuration(created, modified)})
          </span>
        )
      ) : created ? (
        <span>{formatDateTime(created)}</span>
      ) : null}
      <span>{formatBytes(sizeBytes)}</span>
    </div>
  );
}
