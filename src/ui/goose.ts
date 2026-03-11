/**
 * Animated gratitude art frames and rendering helper.
 * Cycles through emoji appreciation graphics when the user navigates prompts.
 */

/**
 * Get the terminal display width of a string.
 * Emoji (above BMP, i.e. surrogate pairs) count as 2 columns;
 * zero-width joiners and variation selectors count as 0;
 * everything else counts as 1.
 */
function displayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const cp = char.codePointAt(0)!;
    if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x200d) continue;
    width += cp > 0xffff ? 2 : 1;
  }
  return width;
}

/** Pad a string with trailing spaces to reach a target display width. */
function padEndDisplay(str: string, targetWidth: number): string {
  return str + " ".repeat(Math.max(0, targetWidth - displayWidth(str)));
}

/**
 * Normalize all frames to identical display dimensions (same height and
 * display width).  Shorter frames get blank lines; narrower lines get padded.
 */
function normalizeFrames(frames: string[][]): string[][] {
  const maxHeight = Math.max(...frames.map((f) => f.length));
  const maxWidth = Math.max(
    ...frames.flatMap((f) => f.map(displayWidth)),
  );
  return frames.map((frame) => {
    const padded = frame.map((l) => padEndDisplay(l, maxWidth));
    while (padded.length < maxHeight) padded.push(" ".repeat(maxWidth));
    return padded;
  });
}

/**
 * 4 frames of emoji gratitude art.
 * All frames are normalized to the same display height and width.
 */
export const GOOSE_FRAMES: string[][] = normalizeFrames([
  // Frame 0: hearts diamond
  [
    "💛       💛",
    "  💚   💚  ",
    "    💙     ",
    "  THANK    ",
    "   YOU!    ",
    "  💜   💜  ",
    "💖       💖",
  ],
  // Frame 1: star border + message
  [
    "🌟 🌟 🌟 🌟",
    "🌟        🌟",
    "🌟  YOU   🌟",
    "🌟  ARE   🌟",
    "🌟AMAZING!🌟",
    "🌟        🌟",
    "🌟 🌟 🌟 🌟",
  ],
  // Frame 2: celebration
  [
    "🎉  🙏  🎉",
    "   SO      ",
    "   MUCH    ",
    " GRATITUDE!",
    "    🙏     ",
    "🎊  🙌  🎊",
    "           ",
  ],
  // Frame 3: trophy
  [
    "  🏆🏆🏆  ",
    "  🏆#1!🏆 ",
    "  🏆🏆🏆  ",
    "    💪     ",
    " YOU'RE THE",
    "   BEST!   ",
    "  🔥🔥🔥  ",
  ],
]);

const FRAME_COUNT = GOOSE_FRAMES.length;
const GOOSE_HEIGHT = GOOSE_FRAMES[0]!.length;

/** Strip ANSI escape codes for accurate character-width measurement. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Display-width of the art column (frame display width + gap). */
const GOOSE_COL_WIDTH = displayWidth(GOOSE_FRAMES[0]![0]!) + 2;

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
