import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CLAUDE_PROJECTS_DIR, GEMINI_TMP_DIR } from "../../config.js";
import { encodeProjectPath } from "../../utils/paths.js";
import { safeReadJson } from "../../utils/fs-helpers.js";

interface Message {
  role: "user" | "assistant" | "system";
  text: string;
}

interface SessionPreviewProps {
  sessionId: string;
  agentSlug: string;
  projectPath: string;
  onBack: () => void;
}

/**
 * Strip IDE context tags from text for cleaner display.
 */
function stripIdeTags(text: string): string {
  return text.replace(/<ide_\w+>[\s\S]*?<\/ide_\w+>/g, "").trim();
}

/**
 * Read Claude Code JSONL session file and extract messages.
 */
async function readClaudeSession(sessionId: string, projectPath: string): Promise<Message[]> {
  const encoded = encodeProjectPath(projectPath);
  const sessionDir = path.join(CLAUDE_PROJECTS_DIR, encoded);
  const jsonlPath = path.join(sessionDir, `${sessionId}.jsonl`);

  const messages: Message[] = [];
  try {
    const content = await fs.readFile(jsonlPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "user" && msg.message?.content) {
          const textBlock = msg.message.content.find(
            (c: { type?: string }) => c.type === "text",
          );
          if (textBlock?.text) {
            messages.push({ role: "user", text: stripIdeTags(textBlock.text) });
          }
        } else if (msg.type === "assistant" && msg.message?.content) {
          const texts: string[] = [];
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) {
              texts.push(block.text);
            } else if (block.type === "tool_use") {
              texts.push(`[tool: ${block.name}]`);
            }
          }
          if (texts.length > 0) {
            messages.push({ role: "assistant", text: texts.join("\n") });
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  } catch {
    // File not found or unreadable
  }
  return messages;
}

/**
 * Read Gemini JSON session file and extract messages.
 */
async function readGeminiSession(sessionId: string, projectPath: string): Promise<Message[]> {
  // Try to find the session in Gemini's tmp dir
  const projectsFile = path.join(os.homedir(), ".gemini", "projects.json");
  const projectsData = await safeReadJson<{ projects?: Record<string, string> }>(projectsFile);
  if (!projectsData?.projects) return [];

  const messages: Message[] = [];

  for (const [, slug] of Object.entries(projectsData.projects)) {
    const chatsDir = path.join(GEMINI_TMP_DIR, slug, "chats");
    try {
      const entries = await fs.readdir(chatsDir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const filePath = path.join(chatsDir, entry);
        const data = await safeReadJson<{
          sessionId?: string;
          messages?: Array<{ type?: string; content?: Array<{ text?: string }> | string }>;
        }>(filePath);
        const fileSessionId = data?.sessionId ?? entry.replace(".json", "");
        if (fileSessionId !== sessionId) continue;

        if (data?.messages) {
          for (const msg of data.messages) {
            const role = msg.type === "user" ? "user" : "assistant";
            let text = "";
            if (typeof msg.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              text = msg.content.map((c) => c.text ?? "").join("\n");
            }
            if (text) {
              messages.push({ role: role as "user" | "assistant", text });
            }
          }
        }
        return messages;
      }
    } catch {
      continue;
    }
  }
  return messages;
}

/**
 * Generic fallback: try to read the session as JSONL (Claude/Codex style).
 */
async function readGenericSession(sessionId: string, projectPath: string): Promise<Message[]> {
  // Try Claude path first
  const messages = await readClaudeSession(sessionId, projectPath);
  if (messages.length > 0) return messages;
  return [];
}

export function SessionPreview({
  sessionId,
  agentSlug,
  projectPath,
  onBack,
}: SessionPreviewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [scroll, setScroll] = useState(0);
  const { stdout } = useStdout();
  const pageSize = Math.max(5, (stdout.rows ?? 24) - 6);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let msgs: Message[];
      if (agentSlug.includes("claude")) {
        msgs = await readClaudeSession(sessionId, projectPath);
      } else if (agentSlug.includes("gemini")) {
        msgs = await readGeminiSession(sessionId, projectPath);
      } else {
        msgs = await readGenericSession(sessionId, projectPath);
      }
      if (!cancelled) {
        setMessages(msgs);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId, agentSlug, projectPath]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setScroll((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setScroll((s) => Math.min(Math.max(0, messages.length - 1), s + 1));
    }
  });

  if (loading) {
    return <Text dimColor>Loading session...</Text>;
  }

  if (messages.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No messages found in this session.</Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  // Build display lines: each message as a block
  const displayLines: Array<{ role: string; text: string }> = [];
  for (const msg of messages) {
    // Truncate long messages to first few lines
    const lines = msg.text.split("\n");
    const preview = lines.slice(0, 6).join("\n");
    const suffix = lines.length > 6 ? `\n  ... (${lines.length - 6} more lines)` : "";
    displayLines.push({ role: msg.role, text: preview + suffix });
  }

  const visible = displayLines.slice(scroll, scroll + pageSize);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold dimColor>Session: {sessionId.slice(0, 20)}...</Text>
        <Text dimColor>  ({messages.length} messages)  Esc back  ↑↓ scroll</Text>
      </Box>
      {scroll > 0 && <Text dimColor>  ↑ {scroll} more</Text>}
      {visible.map((item, i) => {
        const realIndex = scroll + i;
        const roleColor = item.role === "user" ? "cyan" : "green";
        const roleLabel = item.role === "user" ? "You" : "AI";
        return (
          <Box key={realIndex} flexDirection="column" marginBottom={1}>
            <Text bold color={roleColor}>{roleLabel}:</Text>
            <Text wrap="truncate">{item.text}</Text>
          </Box>
        );
      })}
      {scroll + pageSize < displayLines.length && (
        <Text dimColor>  ↓ {displayLines.length - scroll - pageSize} more</Text>
      )}
    </Box>
  );
}
