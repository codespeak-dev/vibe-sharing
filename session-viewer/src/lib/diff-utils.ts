export interface DiffLine {
  type: "context" | "added" | "removed";
  content: string;
  highlights?: { start: number; end: number }[];
}

/**
 * Compute a line-level diff between two strings, with character-level
 * highlights on changed line pairs.
 */
export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Myers-like diff via LCS
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const result: DiffLine[] = [];

  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      // Context line
      result.push({ type: "context", content: oldLines[oi]! });
      oi++;
      ni++;
      li++;
    } else {
      // Collect removed and added lines until the next LCS match
      const removed: string[] = [];
      const added: string[] = [];
      while (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
        removed.push(oldLines[oi]!);
        oi++;
      }
      while (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
        added.push(newLines[ni]!);
        ni++;
      }

      // Compute character-level highlights for 1:1 paired lines
      if (removed.length === added.length) {
        for (let i = 0; i < removed.length; i++) {
          const [rHighlights, aHighlights] = computeCharHighlights(removed[i]!, added[i]!);
          result.push({ type: "removed", content: removed[i]!, highlights: rHighlights });
          result.push({ type: "added", content: added[i]!, highlights: aHighlights });
        }
      } else {
        for (const line of removed) {
          result.push({ type: "removed", content: line });
        }
        for (const line of added) {
          result.push({ type: "added", content: line });
        }
      }
    }
  }

  return result;
}

/**
 * Find the longest common subsequence of two string arrays.
 * Returns the actual subsequence (not indices).
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find the actual subsequence
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result.reverse();
}

/**
 * Compute character-level highlights for a pair of old/new lines.
 * Returns [removedHighlights, addedHighlights] marking the changed substring.
 */
function computeCharHighlights(
  oldLine: string,
  newLine: string
): [{ start: number; end: number }[], { start: number; end: number }[]] {
  if (oldLine === newLine) return [[], []];

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLine.length, newLine.length);
  while (prefixLen < minLen && oldLine[prefixLen] === newLine[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldStart = prefixLen;
  const oldEnd = oldLine.length - suffixLen;
  const newStart = prefixLen;
  const newEnd = newLine.length - suffixLen;

  const rHighlights = oldStart < oldEnd ? [{ start: oldStart, end: oldEnd }] : [];
  const aHighlights = newStart < newEnd ? [{ start: newStart, end: newEnd }] : [];

  return [rHighlights, aHighlights];
}
