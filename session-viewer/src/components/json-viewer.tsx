"use client";

import { useState } from "react";

const MAX_STRING_LEN = 120;

interface JsonViewerProps {
  data: unknown;
  defaultCollapsed?: boolean;
}

export function JsonViewer({ data, defaultCollapsed = false }: JsonViewerProps) {
  return (
    <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
      <JsonNode value={data} depth={0} defaultCollapsed={defaultCollapsed} />
    </pre>
  );
}

function JsonNode({
  value,
  depth,
  defaultCollapsed,
}: {
  value: unknown;
  depth: number;
  defaultCollapsed: boolean;
}) {
  if (value === null) return <span className="text-neutral-500">null</span>;
  if (value === undefined) return <span className="text-neutral-500">undefined</span>;

  if (typeof value === "boolean") {
    return <span className="text-yellow-400">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-blue-400">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <StringNode value={value} />;
  }
  if (Array.isArray(value)) {
    return <ArrayNode value={value} depth={depth} defaultCollapsed={defaultCollapsed} />;
  }
  if (typeof value === "object") {
    return (
      <ObjectNode
        value={value as Record<string, unknown>}
        depth={depth}
        defaultCollapsed={defaultCollapsed}
      />
    );
  }
  return <span>{String(value)}</span>;
}

function StringNode({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = value.length > MAX_STRING_LEN;
  const hasNewlines = value.includes("\n");
  const isExpandable = needsTruncation || hasNewlines;

  if (expanded) {
    return (
      <span>
        <button
          onClick={() => setExpanded(false)}
          className="text-green-400 hover:text-green-300 cursor-pointer text-left"
          title="Click to collapse"
        >
          &quot;
        </button>
        <span className="text-green-300 whitespace-pre-wrap break-all">{value}</span>
        <button
          onClick={() => setExpanded(false)}
          className="text-green-400 hover:text-green-300 cursor-pointer"
          title="Click to collapse"
        >
          &quot;
        </button>
      </span>
    );
  }

  if (isExpandable) {
    const display = needsTruncation ? value.slice(0, MAX_STRING_LEN) : value;
    // JSON-escape for display (show \n as literal \n when collapsed)
    const escaped = JSON.stringify(display).slice(1, -1);
    const truncated = needsTruncation ? escaped + "..." : escaped;
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-green-400 hover:text-green-300 cursor-pointer"
        title="Click to expand full string"
      >
        &quot;{truncated}&quot;
      </button>
    );
  }

  // Short string, no escaping issues - show as-is
  const escaped = JSON.stringify(value).slice(1, -1);
  return <span className="text-green-400">&quot;{escaped}&quot;</span>;
}

function ArrayNode({
  value,
  depth,
  defaultCollapsed,
}: {
  value: unknown[];
  depth: number;
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed || (depth > 1 && value.length > 3));
  const indent = "  ".repeat(depth + 1);
  const closingIndent = "  ".repeat(depth);

  if (value.length === 0) return <span className="text-neutral-400">[]</span>;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
        title="Click to expand"
      >
        [{value.length} items]
      </button>
    );
  }

  return (
    <span>
      <button
        onClick={() => setCollapsed(true)}
        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
        title="Click to collapse"
      >
        [
      </button>
      {"\n"}
      {value.map((item, i) => (
        <span key={i}>
          {indent}
          <JsonNode value={item} depth={depth + 1} defaultCollapsed={defaultCollapsed} />
          {i < value.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      {closingIndent}
      <button
        onClick={() => setCollapsed(true)}
        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
      >
        ]
      </button>
    </span>
  );
}

function ObjectNode({
  value,
  depth,
  defaultCollapsed,
}: {
  value: Record<string, unknown>;
  depth: number;
  defaultCollapsed: boolean;
}) {
  const keys = Object.keys(value);
  const [collapsed, setCollapsed] = useState(
    defaultCollapsed || (depth > 1 && keys.length > 5),
  );
  const indent = "  ".repeat(depth + 1);
  const closingIndent = "  ".repeat(depth);

  if (keys.length === 0) return <span className="text-neutral-400">{"{}"}</span>;

  if (collapsed) {
    const preview = keys.slice(0, 3).join(", ");
    const suffix = keys.length > 3 ? ", ..." : "";
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
        title="Click to expand"
      >
        {"{"} {preview}{suffix} {"}"}
      </button>
    );
  }

  return (
    <span>
      <button
        onClick={() => setCollapsed(true)}
        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
        title="Click to collapse"
      >
        {"{"}
      </button>
      {"\n"}
      {keys.map((key, i) => (
        <span key={key}>
          {indent}
          <span className="text-purple-400">&quot;{key}&quot;</span>
          <span className="text-neutral-400">: </span>
          <JsonNode value={value[key]} depth={depth + 1} defaultCollapsed={defaultCollapsed} />
          {i < keys.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      {closingIndent}
      <button
        onClick={() => setCollapsed(true)}
        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
      >
        {"}"}
      </button>
    </span>
  );
}
