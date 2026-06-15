import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";

const SESSION_VIEWER_ROOT = path.resolve(import.meta.dirname, "..");
const TMP_FILE = path.join(SESSION_VIEWER_ROOT, "_type_check_test.ts");
const TMP_TSCONFIG = path.join(SESSION_VIEWER_ROOT, "_type_check_tsconfig.json");

afterEach(() => {
  if (existsSync(TMP_FILE)) unlinkSync(TMP_FILE);
  if (existsSync(TMP_TSCONFIG)) unlinkSync(TMP_TSCONFIG);
});

// Type-checks a probe file that assigns REGISTRY to Record<TagUnion, EntryTypeSpec> and
// returns tsc's exit code. Matching tsc's error text is intentionally avoided: the message
// wording/code varies (TS2322 vs TS2739/2741, etc.), so the exit code is the stable signal.
function typeCheckExitCode(tagUnion: string): number {
  writeFileSync(
    TMP_TSCONFIG,
    JSON.stringify({
      extends: "./tsconfig.json",
      include: ["_type_check_test.ts"],
    }),
  );
  // ADAPT: the probe imports the submission's registry object + its type-id union and asserts
  // the registry is an exhaustive `Record<union, Spec>`. Repoint these import paths/symbols to
  // the submission's equivalents (the registry module and the type-id union) — the union is taken
  // FROM the impl, so no taxonomy literals are hardcoded here.
  writeFileSync(
    TMP_FILE,
    `import { REGISTRY, type EntryTypeSpec } from "./src/lib/message-type-registry";
import type { EntryTag } from "./src/lib/classify";

type CheckTag = ${tagUnion};
const _check: Record<CheckTag, EntryTypeSpec> = REGISTRY;
`,
  );
  try {
    execSync(`./node_modules/.bin/tsc --noEmit --project ${TMP_TSCONFIG}`, {
      cwd: SESSION_VIEWER_ROOT,
      encoding: "utf-8",
    });
    return 0;
  } catch (err: unknown) {
    const execErr = err as { status?: number };
    return execErr.status ?? 1;
  }
}

/*
 * T07: Scenario: Adding a card type without search criteria fails to compile
 *
 * Given the registry is typed as an exhaustive `Record<MessageType, SearchCriteria>` over
 *   the union of all card-type literals
 * When a developer adds a new identifier to the `MessageType` union without adding the
 *   matching `Record` entry
 * Then `tsc --noEmit` fails on the registry mapping, so the build cannot succeed until
 *   criteria for the new type are supplied
 */
describe("T07: Adding a card type without search criteria fails to compile", () => {
  it("REGISTRY is an exhaustive Record over its type-id union, and extending the union without updating it breaks the build", () => {
    // ADAPT: "EntryTag" is the reference impl's name for the registry's type-id union. Repoint it
    // to the submission's union name. The check itself is behavioural and vocabulary-agnostic:
    // (a) the union the registry is keyed by must type-check, and (b) adding ANY new member to it
    // without a matching REGISTRY entry must fail tsc.
    expect(typeCheckExitCode("EntryTag")).toBe(0);

    // Extending the union without a matching REGISTRY entry must fail the build.
    expect(typeCheckExitCode(`EntryTag | "brand-new-type"`)).not.toBe(0);
  });
});
