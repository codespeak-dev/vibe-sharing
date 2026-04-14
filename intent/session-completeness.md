# Session Completeness Feature

## Overview

When users share their vibe-coded projects with CodeSpeak, we need to understand whether the collected sessions represent the *full* development history of the project, or only a partial picture. Incomplete session sets reduce the value of shared data for training and analysis.

This feature detects incompleteness, explains *why* it's happening, and offers the user a concrete resolution path before they upload.

---

## Implementation Checklist

### Metrics
- [x] Metric 1 — Commit coverage (`src/completeness/metrics.ts`)
- [x] Metric 2 — File coverage with multi-pass resolution (`src/completeness/metrics.ts`)
- [ ] ~~Metric 3 — Line coverage (git blame)~~ — **not planned**
- [ ] ~~Metric 4 — Session gap analysis~~ — **not planned**
- [ ] ~~Metric 5 — Session-to-commit message correlation~~ — **not planned**

### File Coverage Resolution Passes
- [x] Pass 1: Direct absolute path match (`git ls-files` vs Edit/Write tool call paths)
- [x] Pass 1b: Git rename history (`git log --diff-filter=R`) — follow rename chains A→B→C
- [x] Pass 2: Basename heuristic — unique filename match between untracked writes and untouched tracked files
- [x] Pass 3: Content fingerprint — first 10 non-empty lines of last Write call vs same-extension tracked files in git clone
- [x] Match candidates — ambiguous cases (2+ candidates) shown separately in report, not counted in coverage
- [x] Excluded extensions — images, lock files, binaries, fonts, media, etc. removed from denominator
- [x] `--include-candidates` CLI flag to optionally count candidates toward coverage

### UI
- [x] Coverage metrics shown on share-project screen (commit % + file %)
- [x] Coverage metrics shown in review → Git tab
- [x] `scripts/inspect-bundles.ts` — per-bundle Markdown reports with full file-level detail

### Not yet implemented
- [ ] Upload metadata additions (`CompletenessMetadata` in upload payload)
- [ ] Multi-machine bundle endpoint + `--bundle` flag
- [ ] Scenario detection (pre-existing, split-projects, multi-machine)
- [ ] Resolution UI (Ink prompts for each scenario)

---

## Completeness Metrics

There is no single reliable signal for session completeness. We implement **all reasonable metrics**, collect their raw values in every upload, and determine empirically which ones are predictive and what the thresholds should be. No metric is discarded at implementation time — the data will tell us what to use.

All metric values are stored in the upload metadata so they can be analysed across the user population over time.

---

### Metric 1 — Commit coverage

Cross-reference git commit timestamps with session time ranges. A commit is "vibed" if its timestamp falls within an active session window **or within a configurable grace period after the session ended** (default: 60 minutes). The grace period handles the common case where a developer commits just after closing a session — that commit belongs to the session's work.

```
commit_coverage = vibed_commits / total_commits
```

**Pros:** Simple, language-agnostic, doesn't require parsing code.
**Cons:** One large human refactor commit can skew the ratio heavily; doesn't reflect how much of the *code* was AI-written.

---

### Metric 2 — File coverage (writes/edits only)

For each tracked file in the project (from `git ls-files`), check whether any session contains **Edit or Write tool calls** targeting it. Read-only access is excluded — a file being read for context doesn't mean AI worked on it.

```
write_file_coverage = matched_files / counted_tracked_files
```

**Pros:** Captures which parts of the codebase AI actually modified.
**Cons:** AI-heavy projects with many generated files that were later deleted won't show up in `git ls-files`.

#### File matching pipeline

Naive path comparison misses several real-world cases (directory renames, project restructuring). Matching runs in passes, each handling progressively weaker evidence:

**Pass 1 — Direct match**
Resolve each Edit/Write `file_path` against `cwd` to an absolute path, compare against the `git ls-files` set directly.

**Pass 1b — Git rename history**
Extract all renames from `git log --all --diff-filter=R --name-status` and follow rename chains (A→B, B→C resolves to A→C). If a session wrote path P and git records `P → Q`, count the current tracked file Q as touched.

**Pass 2 — Basename heuristic**
If a written path is still unmatched: look for untouched tracked files with the **same filename**. If exactly one exists, treat them as the same file (directory renamed outside git's knowledge). If 2+ exist, save as a *match candidate* (ambiguous — not counted in coverage, listed for manual review).

**Pass 3 — Content fingerprint**
For written paths that have Write-call content (not Edit), take the first 10 non-empty trimmed lines as a fingerprint. Read same-extension untouched tracked files from the git clone and compare fingerprints. If exactly one matches, count it as touched. If 2+ match, save as a *match candidate*.

#### Excluded file types

Certain file types are excluded from the denominator because agents typically cannot generate them directly. Excluded by extension: images (`.png .jpg .svg .ico …`), serialised data (`.json .jsonl`), fonts (`.ttf .woff …`), compiled artifacts (`.wasm .pyc .class …`), archives, media, certificates/keys, databases. Excluded by filename: lock files (`package-lock.json`, `yarn.lock`, `uv.lock`, `Cargo.lock`, `go.sum` …).

Excluded files are listed separately in reports and not counted in either the numerator or denominator.

---

### Metric 3 — Line coverage (git blame) _(not planned)_

Run `git blame` on each source file and classify each line. A line is "vibed" if the commit that last touched it falls within a session window.

```
line_coverage = vibed_lines / total_lines
```

**Pros:** Most precise — reflects what's actually in the codebase today.
**Cons:** Expensive for large repos. Doesn't account for lines the AI wrote that a human later edited (those lines would show as "unvibed"). Requires git blame per file.

Skipped entirely if total tracked lines exceed a configurable threshold (default: **50k lines**) — at that scale the cost outweighs the signal. `lineCoverage` is set to `null` in those cases.

---

### Metric 4 — Session gap analysis _(not planned)_

Look for large time gaps between consecutive sessions and check whether git shows active commits during those gaps.

```
suspicious_gaps = gaps where:
  gap_duration > N days AND
  commits_during_gap > threshold
```

**Pros:** Directly flags "something happened that we have no sessions for".
**Cons:** Needs calibration for N and threshold. Users who commit infrequently produce false positives.

Emits a list of suspicious gap windows, not a single ratio.

---

### Metric 5 — Session-to-commit message correlation _(not planned)_

For each commit, check whether any session contains entries (user prompts, tool calls) that plausibly correspond to the commit's changed files. A commit with no session activity touching its changed files is a candidate "unvibed commit" even if it falls inside a session time window.

```
correlated_commits = commits where at least one changed file
                     was written/edited in a nearby session
uncorrelated_ratio = (total - correlated) / total
```

**Pros:** More accurate than timestamp-only commit coverage — eliminates false "vibed" commits that just happened to land during an open session.
**Cons:** More complex to compute; requires parsing both git diff and session tool calls.

---

### Thresholds

Thresholds are **not defined at implementation time**. All raw metric values are uploaded, and we calibrate thresholds after observing real data across a range of projects. The upload schema records each metric independently so we can run retrospective analysis as understanding improves.

---

## Incompleteness Scenarios and Resolutions

### Scenario 1: Project pre-dates vibe coding

The project existed before the user started using AI coding assistants. Early commits have no sessions and never will.

**Detection signals:**
- Low %vibed with a clear "cliff" in the git timeline (dense commits before a date, then sessions start)
- First session timestamp is significantly later than the first git commit
- Many files never appear in any session

**Resolution:**
Ask the user to confirm: *"It looks like this project started before you used an AI assistant. Is that right?"*
If yes → tag the upload as `origin: pre-existing`. This context tells us to interpret the session data accordingly rather than treating early history as missing.

**UI flow:**
> Hmm, it looks like only ~30% of this project's git history has AI sessions. Did this project exist before you started vibe coding?
> [Yes, it was pre-existing] [No, I think I'm missing sessions]

---

### Scenario 2: Sessions are split across multiple agent projects

The user worked on the same codebase but different Claude (or other agent) sessions were saved under different project names/folders — for example because they opened the project from different paths, renamed the directory, or used a different agent for part of the work.

**Detection signals:**
- Multiple Claude project folders (in `~/.claude/projects/`) whose sessions reference files under the same git repo root
- Sessions from different "projects" overlap in timeline or cover complementary files
- Low %vibed even though the user clearly was vibe coding the whole time

**Resolution:**
Show the user which project folders seem related and let them confirm a merge:

> We found sessions in 3 different project folders that all seem to be working on `my-app`. Do you want to combine them?
> [Show list of folders + session counts]
> [Merge all into this upload] [Upload only current project]

**Implementation note:** After merge, re-compute %vibed against the combined session set before showing the final completeness assessment.

---

### Scenario 3: Work happened on multiple machines

The user vibe-coded the same project on two or more machines. Each machine has its own `~/.claude/projects/` with sessions the other machines don't have.

**Detection signals:**
- Low %vibed even after scenario 2 resolution
- Git history has commits from different machines (different author emails, different timezone patterns, or the user says so)
- Time gaps in sessions that don't align with quiet periods in git activity

**Resolution — multi-machine collection:**
We can't pull sessions from other machines automatically. Instead:

1. Ask the user: *"Did you work on this project on other machines?"*
2. If yes: upload the current machine's sessions as a **partial upload**. The server returns a short **bundle token** for this project.
3. Show the user a ready-to-paste command to run on each other machine:
   ```
   npx codespeak-vibe-share --bundle <bundle-token>
   ```
   This runs the normal share flow on the other machine and appends its sessions to the same server-side bundle.
4. The user can run this on as many machines as needed. No coordination between machines is required.

**Project identity token:**
The token should stably identify the project across machines *without requiring any file to be committed or synced*. Priority order:
1. **Git remote URL** (e.g. `origin` remote) — best: universally unique, already shared across machines
2. **First commit hash** — stable even without a remote; works for purely local repos shared by other means
3. **Fallback:** The server generates a UUID bundle token after the first upload and the user passes it explicitly via `--bundle`. No file is written to disk on the client.

Store the resolved identity in the upload metadata. Server-side, group uploads by bundle token to reconstruct the full session set.

---

## Suggested Improvements

### Progressive disclosure
Don't front-load all questions. Compute all metrics first. Only if signals suggest incompleteness, ask *one* clarifying question. Based on the answer, either resolve immediately (Scenario 1) or investigate further (Scenarios 2 and 3).

### Ordered resolution attempts
Run scenario detection in order of simplicity:
1. First try scenario 2 (cross-project merge) — entirely local, no user action on another machine needed. Re-compute metrics after merge. If now healthy, done.
2. Then try scenario 1 (pre-existing) — ask one yes/no question. If confirmed, done.
3. Finally scenario 3 (multi-machine) — most friction; only surface this if other resolutions didn't resolve the incompleteness signal.

### Don't block uploads
All resolutions should be optional. The user can always choose "upload anyway" with the current sessions. We store whatever context we gathered (e.g. "user said pre-existing", "user declined multi-machine merge") as metadata so the data is still useful.

### All metric values are always uploaded
Even when the completeness check passes and no resolution is triggered, all raw metric values are included in the upload payload. This builds a dataset for calibrating thresholds and understanding which metrics are actually predictive across a range of real projects.

---

## Technical Specification (for implementation)

### New module: `src/completeness/`

```
src/completeness/
  index.ts          — main entry point, orchestrates checks and resolution UI
  metrics.ts        — all completeness metrics (git + session cross-reference)
  scenarios.ts      — scenario detection logic, returns typed findings
  identity.ts       — project identity token resolution
  resolution-ui.ts  — Ink UI components for each resolution prompt
```

### Data types

```ts
/** Raw values for every metric — always computed, always uploaded. */
interface CompletenessMetrics {
  commitCoverage: number | null;           // vibed commits / total commits (null if no git)
  writeFileCoverage: number | null;        // files written/edited in sessions / tracked files
  lineCoverage: number | null;             // vibed lines / total lines (sampled; null if too large)
  sessionCommitCorrelation: number | null; // correlated commits / total commits
  suspiciousGaps: SuspiciousGap[];         // gaps where git shows unexplained activity
}

interface SuspiciousGap {
  start: Date;
  end: Date;
  durationDays: number;
  commitsInGap: number;
}

/** Combined completeness report — metrics + scenario findings. */
interface CompletenessReport {
  metrics: CompletenessMetrics;
  findings: Finding[];           // detected scenarios, ordered by resolution priority
}

type Finding =
  | { kind: "pre-existing"; firstSessionDate: Date; firstCommitDate: Date }
  | { kind: "split-projects"; relatedProjects: RelatedProject[] }
  | { kind: "multi-machine"; projectIdentity: ProjectIdentity };

interface RelatedProject {
  claudeProjectDir: string;      // path to ~/.claude/projects/<id>/
  sessionCount: number;
  fileOverlap: number;           // % of files shared with current project
  dateRange: [Date, Date];
}

interface ProjectIdentity {
  kind: "git-remote" | "first-commit";
  value: string;
}
```

### `metrics.ts` — all completeness metrics

```ts
async function computeMetrics(
  projectRoot: string,
  sessions: LoadedSession[]
): Promise<CompletenessMetrics>
```

**Commit coverage:**
1. `git log --format="%H %aI"` — all commit hashes + ISO timestamps
2. Build extended session windows: `[session.firstTimestamp, session.lastTimestamp + commitGracePeriod]`
   - `commitGracePeriod` is configurable, default **60 minutes** — a commit made shortly after a session ends was almost certainly part of that session
3. For each commit, check if its timestamp falls within any extended session window
4. `commitCoverage = vibedCommits / totalCommits`

**File coverage (writes/edits only):**
1. `git ls-files` — all tracked files; split into *counted* (code, config, docs) and *excluded* (images, lock files, binaries — see `EXCLUDED_EXTENSIONS` / `EXCLUDED_FILENAMES` in `metrics.ts`)
2. Walk all session JSONL files, extract absolute paths from **Edit and Write tool calls only**; for Write calls also capture the written content (for Pass 3)
3. **Pass 1** — direct absolute path match
4. **Pass 1b** — resolve git rename chains via `git log --all --diff-filter=R --name-status`; mark tracked files reachable by rename as touched
5. **Pass 2** — basename heuristic: unique-filename match between unresolved writes and still-untouched tracked files; 2+ matches → save as match candidate
6. **Pass 3** — content fingerprint (first 10 non-empty trimmed lines of last Write content) vs same-extension untouched tracked files read from git clone; unique match → counted; 2+ → match candidate
7. `writeFileCoverage = (direct + renamed + heuristic + content) / countedTrackedFiles`
8. Match candidates are reported separately and optionally included via `--include-candidates`

**Line coverage, session gap analysis, session-commit correlation:** not planned — see checklist.

### `identity.ts` — project identity resolution

```ts
async function resolveProjectIdentity(projectRoot: string): Promise<ProjectIdentity>
```

1. Try `git remote get-url origin` — use the URL, normalized (strip `.git` suffix, normalize SSH/HTTPS variants of the same repo)
2. Try `git log --reverse --format="%H" | head -1` — first commit hash
3. No local fallback — if neither is available, upload without an identity key. The server returns a bundle token after upload; the user passes it explicitly via `--bundle` on other machines.

### `scenarios.ts` — scenario detection

**Split projects detection:**
```ts
async function findRelatedProjects(
  currentProjectRoot: string,
  allClaudeProjects: string[]  // paths to all ~/.claude/projects/<id>/ dirs
): Promise<RelatedProject[]>
```

For each Claude project dir, sample a few session files, extract file paths mentioned in tool calls, and check if those paths are under `currentProjectRoot` (after resolving symlinks). Rank by file overlap %.

**Pre-existing detection:**
```ts
function detectPreExisting(
  firstCommitDate: Date,
  firstSessionDate: Date
): boolean
```

Simple heuristic: if `firstSessionDate - firstCommitDate > 30 days`, likely pre-existing.

### CLI integration

Insert the completeness check into the main share flow, after project selection but before the preview/consent step:

```
1. Discover projects
2. User selects project          ← existing
3. [NEW] Run completeness check
   a. Compute %vibed
   b. If complete → continue
   c. If incomplete → detect scenario → show resolution UI → re-check or mark
4. Preview what will be shared   ← existing
5. Consent + upload              ← existing
```

The resolution UI for each scenario uses Ink components, consistent with the existing share flow UI style.

### Upload metadata additions

Add to the upload payload:
```ts
interface CompletenessMetadata {
  metrics: CompletenessMetrics;        // all raw metric values, always present
  resolutionApplied: "none" | "pre-existing" | "merged-projects" | "multi-machine-partial";
  projectIdentity?: ProjectIdentity;   // for multi-machine linking
  mergedProjectDirs?: string[];        // for merged-projects case
}
```

### Multi-machine bundle endpoint

New server-side concept: uploads are grouped into a **project bundle** identified by a server-generated token. Flow:

1. First machine uploads with `uploadKind: "partial"` and whatever project identity could be derived (git remote or first commit hash, or none).
2. Server creates a bundle, returns a short opaque `bundleToken`.
3. CLI prints the `--bundle <bundleToken>` command for the user to copy.
4. Subsequent machines run `codespeak-vibe-share --bundle <bundleToken>`, which uploads with `uploadKind: "supplemental"` and the same token.
5. Server appends sessions to the bundle. No deduplication is needed client-side.

The `--bundle` flag bypasses the normal project-selection UI and goes straight to the share flow for the project whose git remote / first commit hash matches the bundle's recorded identity (or asks the user to confirm if ambiguous).

This can be a v2 addition — v1 can just include the project identity in upload metadata without the bundle UI.
