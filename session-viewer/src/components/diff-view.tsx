"use client";

import { useMemo } from "react";
import { computeLineDiff, type DiffLine } from "@/lib/diff-utils";

function renderLine(line: DiffLine, highlightClass: string) {
  const { content, highlights } = line;
  if (!highlights || highlights.length === 0) {
    return <span>{content}</span>;
  }

  const segments: React.ReactNode[] = [];
  let pos = 0;
  for (const h of highlights) {
    if (h.start > pos) {
      segments.push(<span key={`t-${pos}`}>{content.slice(pos, h.start)}</span>);
    }
    segments.push(
      <span key={`h-${h.start}`} className={highlightClass}>
        {content.slice(h.start, h.end)}
      </span>
    );
    pos = h.end;
  }
  if (pos < content.length) {
    segments.push(<span key={`t-${pos}`}>{content.slice(pos)}</span>);
  }
  return <>{segments}</>;
}

const lineStyles = {
  context: "",
  removed: "bg-red-950/30 text-red-300/70",
  added: "bg-green-950/30 text-green-300/70",
} as const;

const prefixChar = {
  context: " ",
  removed: "-",
  added: "+",
} as const;

const highlightStyles = {
  removed: "bg-red-700/40 rounded-sm",
  added: "bg-green-700/40 rounded-sm",
} as const;

export function OldNewDiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const lines = useMemo(() => computeLineDiff(oldStr, newStr), [oldStr, newStr]);

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={lineStyles[line.type]}>
          <span className="select-none opacity-50">{prefixChar[line.type]} </span>
          {line.type === "context"
            ? <span>{line.content}</span>
            : renderLine(line, highlightStyles[line.type])
          }
        </div>
      ))}
    </pre>
  );
}
