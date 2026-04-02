# Vibe Coder Personality Test (V.I.B.E.S.)

## Context

Build a fun, MBTI-style personality test that analyzes a developer's AI coding sessions, git history, and project structure to classify them into one of 32 "vibe coder" archetypes. The system uses 5 binary traits that form the acronym **V.I.B.E.S.** - each trait has a "high" and "low" pole with emoji and a catchy label.

Inspired by the ideas in `intent/app/vibe-personality.md`. Research shows one similar project exists (a "Vibe Coding Profile" on DEV Community with 6 axes) but nothing using the specific trait set or MBTI-style archetype approach we're designing.

**Key decisions:**
- **Scope**: Analyze all projects by default, let user exclude some. Implementation accepts a set of project paths.
- **Agents**: Claude Code only (richest data, simplest). Others can be added later.
- **Archetypes**: Define ~8 key archetypes with names/descriptions. Remaining types show raw trait codes + auto-generated labels.

---

## The 5 Traits

| Code | Trait | High Pole | Low Pole | What it measures |
|------|-------|-----------|----------|-----------------|
| **V** | Vigilance | `Hawk` | `Ostrich` | How much you review/correct the AI agent |
| **I** | Input | `Novelist` | `Telegraphist` | How verbose your prompts are |
| **B** | Bandwidth | `Butterfly` | `Laser` | How scattered vs focused your work is |
| **E** | Energy | `Night Owl` | `Early Bird` | When you code |
| **S** | Structure | `Architect` | `Cowboy` | Code quality discipline |

5 binary traits -> 32 personality types, each with a fun archetype name like "The Chaos Gremlin", "The Silent Assassin", "The Helicopter Parent", etc.

---

## Implementation Plan

### New files

```
src/personality/
  types.ts              -- Interfaces: RawMetrics, TraitScore, PersonalityResult, Archetype
  extract-claude.ts     -- Parse Claude Code JSONL sessions for all projects
  extract-git.ts        -- Parse git history for each project
  extract-project.ts    -- Check project files for structure indicators
  extract.ts            -- Coordinator: run all extractors across project set, merge into RawMetrics
  scoring.ts            -- Convert RawMetrics -> 5 trait scores (0-100)
  archetypes.ts         -- ~8 named archetypes + fallback label generation for rest
  display.ts            -- Terminal output: bar chart + archetype reveal
  index.ts              -- CLI command entry point (project selection UI)
```

### Modified files

- [src/index.ts](src/index.ts) -- Register `personality` subcommand

---

### Step 1: Types (`types.ts`)

```typescript
interface RawMetrics {
  vigilance: {
    correctionPhrases: number    // "no", "wrong", "actually", "don't", "stop", "undo"
    questionCount: number        // messages ending with "?"
    toolRejections: number       // tool_result with is_error: true
    totalUserPrompts: number     // denominator
  }
  inputStyle: {
    messageLengths: number[]     // char count per user message
    messageWordCounts: number[]  // word count per user message
  }
  bandwidth: {
    sessionsPerDay: Map<string, number>  // ISO date -> count
    maxConcurrent: number                // overlapping sessions by timestamp
    totalSessions: number
    abandonedSessions: number            // last msg is assistant (user never replied)
  }
  energyCycle: {
    activityHours: number[]     // hour-of-day (0-23) for each user message + commit
  }
  structure: {
    testFileCount: number
    totalFileCount: number
    hasLinterConfig: boolean
    hasCIConfig: boolean
    hasAgentConfig: boolean     // CLAUDE.md, AGENTS.md
    testMentionsInPrompts: number
    commitMessageQuality: number  // 0-1 ratio of "good" messages
  }
}

interface TraitScore {
  code: string           // "V", "I", "B", "E", "S"
  name: string           // "Vigilance"
  score: number          // 0-100
  highLabel: string      // "Hawk"
  lowLabel: string       // "Ostrich"
  isHigh: boolean        // score >= 50
  details: string[]      // human-readable signal explanations
}

interface Archetype {
  code: string           // "HHLNA" (first letter of each pole)
  name: string           // "The Silent Assassin"
  emoji: string          // "🥷"
  description: string    // 2-3 sentences
}

interface PersonalityResult {
  traits: TraitScore[]
  archetype: Archetype
  sampleSize: { sessions: number; prompts: number; commits: number }
}
```

### Step 2: Claude Code session extraction (`extract-claude.ts`)

Parse JSONL files using the existing `readJsonl` utility from [src/utils/fs-helpers.ts](src/utils/fs-helpers.ts).

**Input**: array of project paths (from user selection).

For each project path:
1. Find session dir via `encodeProjectPath` (same as [src/sessions/agents/claude.ts](src/sessions/agents/claude.ts))
2. Stream each `.jsonl` file
3. For each `type: "user"` message **without** `toolUseResult` (= actual human prompt):
   - Extract text via `message.content[].text`, strip IDE tags (reuse `stripIdeTags` pattern)
   - Record: char length, word count, timestamp hour (local time)
   - Scan for correction keywords: `/\b(no|wrong|actually|don't|stop|wait|undo|revert|that's not|incorrect)\b/i`
   - Scan for trailing `?` (question)
   - Scan for "test" mentions
4. For `type: "user"` **with** `toolUseResult`: check `is_error: true` content blocks (= tool rejections)
5. For `type: "assistant"`: record timestamp for activity hours
6. Track per-session: first/last timestamp (for concurrency detection), whether last non-system message is assistant (abandoned)

Key reusable code from existing codebase:
- `readJsonl` from [src/utils/fs-helpers.ts](src/utils/fs-helpers.ts)
- `encodeProjectPath` from [src/utils/paths.ts](src/utils/paths.ts)
- `CLAUDE_PROJECTS_DIR` from [src/config.ts](src/config.ts)
- `stripIdeTags` pattern from [src/sessions/agents/claude.ts](src/sessions/agents/claude.ts)

### Step 3: Git extraction (`extract-git.ts`)

Use `execFile("git", ...)` pattern from [src/utils/project-stats.ts](src/utils/project-stats.ts). Run for each project that has a git repo.

Git signals feed multiple traits:

- **Energy Cycle**: `git log --all --format="%aI"` -> extract hour-of-day from author timestamps
- **Structure**: `git log --all --format="%s"` -> commit message quality (length > 10, not "wip"/"fix"/"tmp"/"asdf")
- **Structure**: `git log --all --format="%H" --grep="revert" -i` -> revert count (also feeds Vigilance)
- **Vigilance**: commit frequency patterns — rapid consecutive commits to same file suggest corrections
- **Bandwidth**: `git log --all --format="%aI"` -> commits per day (supplements session-based measurement)

Reuse `getGitRoot` from [src/utils/paths.ts](src/utils/paths.ts). Skip gracefully for non-git projects.

### Step 4: Project structure extraction (`extract-project.ts`)

Use `git ls-files` output to check for:
- **Test files**: `*.test.*`, `*.spec.*`, `*_test.*`, `__tests__/`, `test/`, `tests/`
- **Linter configs**: `.eslintrc*`, `.prettierrc*`, `biome.json`, `.ruff.toml`, `.rubocop.yml`
- **CI configs**: `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`
- **Agent configs**: `CLAUDE.md`, `AGENTS.md`, `.claude/`

### Step 5: Scoring (`scoring.ts`)

Each trait: weighted combination of normalized sub-signals -> clamped to 0-100.

**V - Vigilance**: `correctionRate * 200 + questionRate * 100 + rejectionRate * 300 + gitRevertRate * 500` (normalized)
- Sources: session prompts (corrections, questions, rejections) + git (reverts, rapid re-commits)
- More corrections/questions/rejections/reverts = Hawk

**I - Input Style**: `median(messageLengths)` mapped to 0-100 scale
- Source: session user messages only
- Calibration: ~20 chars = 0 (Telegraphist), ~200+ chars = 100 (Novelist)

**B - Bandwidth**: `avgSessionsPerDay * 15 + maxConcurrent * 15 + abandonmentRate * 40`
- Sources: session timestamps (concurrency, abandonment) + git commits per day
- More parallel/abandoned sessions = Butterfly

**E - Energy Cycle**: `nightActivityRatio` (hours 20-4 vs 5-11) mapped to 0-100
- Sources: session message timestamps + git commit timestamps (merged into single hour distribution)
- 0 = pure Early Bird, 100 = pure Night Owl

**S - Structure**: `testRatio * 200 + linterBonus(15) + ciBonus(15) + agentConfigBonus(10) + testPromptRate * 200 + commitQuality * 20`
- Sources: project files (tests, configs) + session prompts ("test" mentions) + git (commit message quality)

### Step 6: Archetypes (`archetypes.ts`)

32 entries. Naming scheme based on trait combinations:
- High V + High S = disciplined (Architect, Inspector)
- Low V + Low S = wild (Gremlin, Cowboy)
- High I = social/verbose (Speaker, Professor)
- Low I = terse/action (Assassin, Commando)
- High B = scattered (Butterfly, Juggler)
- Low B = focused (Laser, Monk)
- Night = mysterious; Early = wholesome

**8 named archetypes** (hand-crafted):

| V | I | B | E | S | Name | Emoji | Description |
|---|---|---|---|---|------|-------|-------------|
| H | H | L | E | H | The Helicopter Parent | 🚁 | Reviews every line, writes detailed specs, focused and disciplined. You treat AI like a brilliant but unreliable intern. |
| L | L | H | N | L | The Chaos Gremlin | 👹 | Trusts the vibes, fires off terse commands across 12 parallel sessions at 3am. Pure entropy. |
| H | L | L | N | H | The Silent Assassin | 🥷 | Few words, laser focus, meticulous review. While the world sleeps, you build fortresses. |
| L | H | H | E | L | The Conference Speaker | 🎤 | Your prompts are blog posts. You juggle many threads but never met a test you couldn't skip. |
| L | L | L | N | H | The Batman | 🦇 | Terse, focused, nocturnal, disciplined. You trust your AI sidekick but the architecture is yours. |
| L | L | L | E | H | The Efficiency Engine | ⚙️ | Minimum input, maximum output. Short prompts, one task at a time, everything tested by lunch. |
| L | L | L | E | L | The Yolo Deployer | 🚀 | Ship it. Ship it now. Tests are for people who lack faith. |
| H | H | H | N | L | The Midnight Rambler | 🎸 | Verbose, scattered, nocturnal — but nothing escapes your review. Creative chaos with guardrails. |

**Remaining 24 types**: Auto-generate a label from trait poles (e.g., "Hawk / Novelist / Laser / Early Bird / Cowboy") and a generic description. Can be hand-crafted later as the feature matures.

### Step 7: Display (`display.ts`)

Terminal output using `chalk` (already a dependency):

```
╔══════════════════════════════════════════════╗
║  🧬 Your V.I.B.E.S. Profile                 ║
╠══════════════════════════════════════════════╣

  🔍 Vigilance    ████████████████░░░░  78  Hawk
  ⚡ Input Style   ████████░░░░░░░░░░░░  38  Telegraphist
  🦋 Bandwidth    ██████████████░░░░░░  65  Butterfly
  🦉 Energy       ████████████████████  92  Night Owl
  🏗️ Structure    ████████████████░░░░  76  Architect

╠══════════════════════════════════════════════╣
║  🥷 You are: The Silent Assassin             ║
║                                              ║
║  You keep a watchful eye on your AI with     ║
║  surgical precision. Terse prompts belie     ║
║  the careful review happening behind the     ║
║  scenes. While the world sleeps, you build.  ║
╚══════════════════════════════════════════════╝

  Based on 49 sessions · 312 prompts · 1,247 commits
```

Uses `█` and `░` for bar chart. Each trait shows score and which pole it falls on.

### Step 8: CLI wiring (`index.ts`)

Add a `personality` subcommand to Commander in [src/index.ts](src/index.ts):

```typescript
program
  .command("personality")
  .alias("vibes")
  .description("Discover your vibe-coding personality")
  .option("--verbose", "Show detailed scoring breakdown")
  .option("--json", "Output as JSON")
  .action(async (options) => { ... })
```

**Flow:**
1. Discover all projects with Claude Code sessions (reuse `ClaudeCodeProvider.discoverProjects()`)
2. Show project list with checkboxes (all selected by default), let user deselect. Use `@inquirer/prompts` (already a dependency).
3. For selected projects, run extractors in parallel
4. Merge metrics across all projects into single RawMetrics
5. Score, classify, display

---

## Edge Cases

- **Insufficient data**: If < 3 sessions or < 5 prompts, show "Not enough data" for affected traits
- **No git repo**: Skip git-based metrics for those projects, still compute from sessions
- **No Claude Code sessions**: Only compute Structure from project files + git
- **Timezone**: Convert UTC timestamps to local time using system timezone for Energy Cycle
- **Large session dirs**: Some users have thousands of sessions. Stream JSONL files, don't load all into memory. Show a progress spinner.

## Verification

1. Run `npx tsx src/index.ts personality` — should discover projects, show selection, compute traits, display result
2. Run with `--verbose` — should show raw metric breakdown per trait
3. Run with `--json` — should output valid JSON
4. Test with a project that has many sessions + tests + git history (expect high Structure, meaningful scores)
5. Test edge case: project with no sessions (should still compute Structure + Energy from git only)
