import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import fs from "node:fs/promises";

interface FilePreviewProps {
  filePath: string;
  maxLines?: number;
  active?: boolean;
  onBack?: () => void;
}

export function FilePreview({
  filePath,
  maxLines = 100,
  active = true,
  onBack,
}: FilePreviewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { stdout } = useStdout();
  const pageSize = Math.max(5, (stdout.rows ?? 24) - 8);

  useEffect(() => {
    let cancelled = false;
    fs.readFile(filePath, "utf-8")
      .then((content) => {
        if (cancelled) return;
        const allLines = content.split("\n").slice(0, maxLines);
        setLines(allLines);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, maxLines]);

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.escape && onBack) {
        onBack();
      } else if (key.upArrow) {
        setScroll((s) => Math.max(0, s - 1));
      } else if (key.downArrow) {
        setScroll((s) => Math.min(Math.max(0, lines.length - pageSize), s + 1));
      }
    },
    { isActive: active },
  );

  if (error) {
    return <Text color="red">Error reading file: {error}</Text>;
  }

  if (lines.length === 0) {
    return <Text dimColor>Loading...</Text>;
  }

  const visible = lines.slice(scroll, scroll + pageSize);
  const lineNumWidth = String(scroll + pageSize).length;

  return (
    <Box flexDirection="column">
      <Text dimColor bold>
        {filePath}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((line, i) => {
          const lineNum = String(scroll + i + 1).padStart(lineNumWidth, " ");
          return (
            <Text key={scroll + i}>
              <Text dimColor>{lineNum} </Text>
              {line}
            </Text>
          );
        })}
      </Box>
      {lines.length > pageSize && (
        <Text dimColor>
          Lines {scroll + 1}-{Math.min(scroll + pageSize, lines.length)} of{" "}
          {lines.length}
        </Text>
      )}
    </Box>
  );
}
