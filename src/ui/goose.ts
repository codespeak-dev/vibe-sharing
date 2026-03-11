/**
 * Animated ASCII goose frames and rendering helper.
 * The goose flaps its wings when rendered alongside interactive prompts.
 */

/**
 * 4 frames of a front-facing goose with wing flapping animation.
 * Each frame is 7 lines tall, padded to 15 chars wide.
 */
export const GOOSE_FRAMES: string[][] = [
  // Frame 0: wings down (at rest)
  [
    "      ___      ",
    "     (. .)     ",
    "     (   )     ",
    "     /   \\     ",
    "    (_   _)    ",
    "      | |      ",
    "     _| |_     ",
  ],
  // Frame 1: wings extending out
  [
    "      ___      ",
    "     (. .)     ",
    "    /(   )\\    ",
    "   / /   \\ \\   ",
    "    (_   _)    ",
    "      | |      ",
    "     _| |_     ",
  ],
  // Frame 2: wings spread
  [
    "      ___      ",
    "   _ (. .) _   ",
    "  / \\(   )/ \\  ",
    "     /   \\     ",
    "    (_   _)    ",
    "      | |      ",
    "     _| |_     ",
  ],
  // Frame 3: wings fully up
  [
    "  \\   ___   /  ",
    "   \\ (. .) /   ",
    "     (   )     ",
    "     /   \\     ",
    "    (_   _)    ",
    "      | |      ",
    "     _| |_     ",
  ],
];

const FRAME_COUNT = GOOSE_FRAMES.length;
const GOOSE_HEIGHT = GOOSE_FRAMES[0]!.length;

/** Strip ANSI escape codes for accurate character-width measurement. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Width of the goose column (frame width + gap to content). */
const GOOSE_COL_WIDTH = GOOSE_FRAMES[0]![0]!.length + 2;

/**
 * Render the goose alongside prompt output.
 *
 * The goose is drawn at the bottom-left corner. Prompt lines that
 * overlap with the goose get the goose art prepended on the left;
 * all other lines are indented by the same amount so text stays aligned.
 */
export function renderWithGoose(
  promptOutput: string,
  frameIndex: number,
): string {
  const frame = GOOSE_FRAMES[frameIndex % FRAME_COUNT]!;
  const lines = promptOutput.split("\n");

  const blankCol = " ".repeat(GOOSE_COL_WIDTH);

  // The goose is bottom-aligned: its last line matches the last prompt line.
  // If the prompt is shorter than the goose, extra goose lines are added above.
  const totalLines = Math.max(lines.length, GOOSE_HEIGHT);
  const gooseStartLine = totalLines - GOOSE_HEIGHT;
  const promptStartLine = totalLines - lines.length;

  const result: string[] = [];
  for (let i = 0; i < totalLines; i++) {
    const gooseIdx = i - gooseStartLine;
    const promptIdx = i - promptStartLine;

    const left =
      gooseIdx >= 0 && gooseIdx < GOOSE_HEIGHT
        ? frame[gooseIdx]! + "  "
        : blankCol;

    const right = promptIdx >= 0 ? lines[promptIdx]! : "";
    result.push(left + right);
  }

  return result.join("\n");
}
