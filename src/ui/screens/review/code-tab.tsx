import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { buildFileTree, type FileTreeNode } from "../../../utils/file-tree.js";
import { FilePreview } from "../../components/file-preview.js";
import { Spinner } from "../../components/spinner.js";
import path from "node:path";

interface CodeTabProps {
  projectPath: string;
  active?: boolean;
  onPreviewChange?: (active: boolean) => void;
  onBoundary?: (direction: "up" | "down") => void;
}

interface FlatNode {
  node: FileTreeNode;
  depth: number;
}

function flattenTree(nodes: FileTreeNode[], depth: number = 0): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.isDirectory && node.expanded && node.children) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

export function CodeTab({ projectPath, active = true, onPreviewChange, onBoundary }: CodeTabProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildFileTree(projectPath)
      .then((nodes) => {
        if (!cancelled) {
          setTree(nodes);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const flat = flattenTree(tree);
  const { stdout } = useStdout();
  const pageSize = Math.max(5, (stdout.rows ?? 24) - 10);

  const openPreview = (filePath: string) => {
    setPreviewFile(filePath);
    onPreviewChange?.(true);
  };

  const closePreview = () => {
    setPreviewFile(null);
    onPreviewChange?.(false);
  };

  useInput((input, key) => {
    if (previewFile) {
      if (key.escape) closePreview();
      return;
    }
    if (!active) return;

    if (key.upArrow) {
      if (cursor === 0) {
        onBoundary?.("up");
      } else {
        setCursor((c) => Math.max(0, c - 1));
      }
    } else if (key.downArrow) {
      if (cursor >= flat.length - 1) {
        onBoundary?.("down");
      } else {
        setCursor((c) => Math.min(flat.length - 1, c + 1));
      }
    } else if (key.return) {
      const item = flat[cursor];
      if (!item) return;
      if (item.node.isDirectory) {
        if (!item.node.shared) return; // Can't open not-shared dirs
        // Toggle expand
        item.node.expanded = !item.node.expanded;
        setTree([...tree]); // Force re-render
      } else if (item.node.shared) {
        openPreview(path.join(projectPath, item.node.path));
      }
    }
  }, { isActive: active || !!previewFile });

  if (loading) return <Spinner label="Loading file tree..." />;

  if (previewFile) {
    return (
      <FilePreview
        filePath={previewFile}
        onBack={closePreview}
      />
    );
  }

  // Visible window
  const halfPage = Math.floor(pageSize / 2);
  let start = Math.max(0, cursor - halfPage);
  const end = Math.min(flat.length, start + pageSize);
  if (end - start < pageSize) start = Math.max(0, end - pageSize);

  const visible = flat.slice(start, end);

  return (
    <Box flexDirection="column">
      {start > 0 && <Text dimColor>  ↑ {start} more</Text>}
      {visible.map((item, i) => {
        const realIndex = start + i;
        const isCurrent = realIndex === cursor;
        const showHighlight = isCurrent && active;
        const indent = "  ".repeat(item.depth);
        const icon = item.node.isDirectory
          ? item.node.expanded
            ? "📂 "
            : "📁 "
          : "   ";
        const notShared = !item.node.shared ? " [Not Shared]" : "";

        return (
          <Text
            key={item.node.path}
            color={showHighlight ? "cyan" : undefined}
            bold={showHighlight}
            dimColor={!item.node.shared || (!active && !isCurrent)}
          >
            {showHighlight ? " > " : "   "}
            {indent}
            {icon}
            {item.node.name}
            {notShared}
          </Text>
        );
      })}
      {end < flat.length && <Text dimColor>  ↓ {flat.length - end} more</Text>}
    </Box>
  );
}
