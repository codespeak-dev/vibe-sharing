#!/bin/sh
# Axis-1 + Axis-2 meta-rubric harness for the "add Playwright tests" case.
#
# Grades the SUBMISSION'S OWN test suite (not a gold behaviour test):
#   Axis 1 (infra reuse): the submitted package.json keeps the base playwright
#     line (^1.59.1); no playwright-family dep is introduced at a divergent version.
#   Axis 2 (discrimination): the submission's own playwright tests must FAIL against
#     a known-buggy scroll impl and PASS against a known-fixed one — i.e. they
#     actually reproduce the bug the task is about.
#
# Emits junit.xml at repo root with two testcases: T01_infra_reuse, T02_discrimination.
#
# Env contract (set by the eval launch):
#   CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER  server port
#   HOME                                          throwaway fixture home (server reads sessions here)
# Layout: run from repo root. Harness assets under session-viewer/.exemplar-harness/:
#   client.buggy.tsx, client.fixed.tsx
set -u

ROOT="$(pwd)"
SV="$ROOT/session-viewer"
HARNESS="$SV/.exemplar-harness"
# ADAPT: CLIENT is the reference session-page client that owns the scroll-to-target
# behaviour; Axis 2 swaps its buggy/fixed variants here to probe the submission's
# tests. Primary is the reference's path; if a submission MOVED/renamed the file we
# fall back to locating the session-page client by content, so the swap still targets
# the right file instead of failing on a stale path.
CLIENT="$SV/src/app/project/[projectPath]/session/[sessionId]/client.tsx"
if [ ! -f "$CLIENT" ]; then
  # (1) a client component under a session route; (2) else any component under a
  # session route; (3) else any .tsx that scrolls a deep-link target into view (the
  # scroll-to-target owner). First hit wins.
  CAND="$(find "$SV/src" -type f -name '*.tsx' -path '*session*client*' 2>/dev/null | head -1)"
  [ -z "$CAND" ] && CAND="$(find "$SV/src" -type f -name '*.tsx' -path '*session*' 2>/dev/null | head -1)"
  [ -z "$CAND" ] && CAND="$(grep -rl "scrollIntoView" "$SV/src" --include='*.tsx' 2>/dev/null | head -1)"
  [ -n "$CAND" ] && CLIENT="$CAND"
fi
PORT="${CODESPEAK_EVALS_PORT_FOR_NEXT_JS_DEV_SERVER:-3000}"
# ADAPT: the base project already ships Playwright at this line; Axis 1 flags any
# playwright-family dependency the submission introduces at a different version.
BASE_PW_VERSION="1.59.1"
JUNIT="$ROOT/junit.xml"
# throwaway fixture home: the server reads sessions from here (os.homedir()->$HOME),
# and the submission's tests seed into SV_FIXTURE_HOME -> same dir. Keep npm/node on
# the real HOME by only overriding HOME for the server subprocess.
FIXHOME="$(mktemp -d)"
trap 'rm -rf "$FIXHOME"' EXIT

# ── deterministic scroll-to-target fixture ─────────────────────────────
# The server reads sessions from $HOME/.claude/projects (os.homedir()->$FIXHOME).
# NOTHING in the base project seeds a session there, so without this block every
# submission navigates to a non-existent session, the page shows "No entries", and
# the buggy and fixed clients are INDISTINGUISHABLE (both never render an entry) —
# T02 can never discriminate. We seed ONE deterministic session so the scroll-to-
# target behaviour is actually exercised. The seed is byte-identical for the buggy
# and fixed runs, so the ONLY variable across the two arms is client.tsx.
#
# Layout (lineIndex = 0-based non-empty line index, the id the app puts on each card
# as `entry-<lineIndex>`):
#   0  user prompt            (primary — opens the transcript)
#   1  assistant tool_use     (non-primary)                    ┐
#   2  user   tool_result     (non-primary)                    │ consecutive
#   3  assistant tool_use     (non-primary) ← SCROLL TARGET     │ non-primary run
#   4  user   tool_result     (non-primary)                    ┘ → collapsed group
#   5  assistant text         (primary — closes the group)
# The run of lines 1-4 collapses into a group that is closed by default, so the
# target card at lineIndex 3 is hidden until the deep link expands it. This is the
# scenario the task names ("a card that isn't shown by default, hidden inside a
# collapsed group").
FIX_PROJECT_PATH="/fixture/scroll-project"
# encodeProjectPath(): every "/" -> "-"  (on-disk $HOME/.claude/projects/<dir> name)
FIX_ENCODED_DIR="-fixture-scroll-project"
FIX_SESSION_ID="f1x2u3r4-0000-4000-8000-000000000001"
# the target card's lineIndex (== 0-based non-empty line in the JSONL below)
FIX_TARGET_LINE=3

seed_fixture() {
  sdir="$FIXHOME/.claude/projects/$FIX_ENCODED_DIR"
  mkdir -p "$sdir"
  cat > "$sdir/$FIX_SESSION_ID.jsonl" <<JSONL
{"type":"user","uuid":"f0000000-0000-4000-8000-000000000000","parentUuid":null,"cwd":"$FIX_PROJECT_PATH","sessionId":"$FIX_SESSION_ID","timestamp":"2024-01-01T10:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"Please run the build and report back."}]}}
{"type":"assistant","uuid":"f0000000-0000-4000-8000-000000000001","parentUuid":"f0000000-0000-4000-8000-000000000000","sessionId":"$FIX_SESSION_ID","timestamp":"2024-01-01T10:00:01.000Z","message":{"id":"msg_1","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"npm run lint"}}]}}
{"type":"user","uuid":"f0000000-0000-4000-8000-000000000002","parentUuid":"f0000000-0000-4000-8000-000000000001","sessionId":"$FIX_SESSION_ID","timestamp":"2024-01-01T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"lint ok"}]}}
{"type":"assistant","uuid":"f0000000-0000-4000-8000-000000000003","parentUuid":"f0000000-0000-4000-8000-000000000002","sessionId":"$FIX_SESSION_ID","timestamp":"2024-01-01T10:00:03.000Z","message":{"id":"msg_2","role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"npm run build --workspaces"}}]}}
{"type":"user","uuid":"f0000000-0000-4000-8000-000000000004","parentUuid":"f0000000-0000-4000-8000-000000000003","sessionId":"$FIX_SESSION_ID","timestamp":"2024-01-01T10:00:04.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"build succeeded in 12.4s"}]}}
{"type":"assistant","uuid":"f0000000-0000-4000-8000-000000000005","parentUuid":"f0000000-0000-4000-8000-000000000004","sessionId":"$FIX_SESSION_ID","timestamp":"2024-01-01T10:00:05.000Z","message":{"id":"msg_3","role":"assistant","content":[{"type":"text","text":"The build succeeded. All checks are green."}]}}
JSONL
  # drop the mtime-keyed sqlite cache so the server re-ingests the fresh fixture
  rm -f "$ROOT/.session-viewer-cache.db"
}

# ── result accumulators ───────────────────────────────────────────────
a1_ok=0; a1_msg=""
a2_ok=0; a2_msg=""

emit_junit() {
  a1_fail=""; a2_fail=""
  [ "$a1_ok" = 1 ] || a1_fail="<failure message=\"$a1_msg\"></failure>"
  [ "$a2_ok" = 1 ] || a2_fail="<failure message=\"$a2_msg\"></failure>"
  cat > "$JUNIT" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="add-tests-meta-rubric" tests="2" failures="$((2-a1_ok-a2_ok))">
    <testcase classname="meta" name="T01 reuses the existing Playwright toolchain: no playwright dependency reinstalled or version-bumped off the project's existing 1.59 line">$a1_fail</testcase>
    <testcase classname="meta" name="T02 the added tests reproduce the scroll-to-target bug: at least one submitted test fails on the buggy implementation and passes on the fixed one">$a2_fail</testcase>
  </testsuite>
</testsuites>
XML
  echo "=== junit written to $JUNIT ==="
  cat "$JUNIT"
}

# ── Axis 1: infra reuse (reads the pre-install snapshot) ───────────────
axis1() {
  SNAP="${SV_PKG_SNAPSHOT:-$HARNESS/pkg.submitted.json}"
  if [ ! -f "$SNAP" ]; then a1_msg="package.json snapshot missing at $SNAP"; return; fi
  # extract every playwright-family version string
  bad="$(node -e '
    const fs=require("fs");
    const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const base=process.argv[2];
    const deps={...(p.dependencies||{}),...(p.devDependencies||{})};
    const offenders=[];
    for(const [k,v] of Object.entries(deps)){
      if(/playwright/.test(k)){
        const ver=String(v).replace(/[^0-9.]/g,"");
        // accept exact base line (same major.minor) — reject anything else
        const bm=base.split(".").slice(0,2).join(".");
        const vm=ver.split(".").slice(0,2).join(".");
        if(vm!==bm) offenders.push(k+"@"+v);
      }
    }
    process.stdout.write(offenders.join(", "));
  ' "$SNAP" "$BASE_PW_VERSION")"
  # ALSO a T01 violation: importing the separate `@playwright/test` runner package while the project
  # ships only `playwright` (whose runner lives at the `playwright/test` SUBPATH) and never DECLARES
  # `@playwright/test`. Using an undeclared package is a toolchain-reuse failure — and it crashes
  # `next build` with "Cannot find module '@playwright/test'", which downstream would otherwise be
  # mislabelled as a T02 "UNGRADABLE / client restructure". Catch it here as the T01 defect it is.
  # (If `@playwright/test` IS declared but off the 1.59 line, the version check above already flags it.)
  declared_pwtest="$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const d={...(p.dependencies||{}),...(p.devDependencies||{})};process.stdout.write(d["@playwright/test"]?"1":"")' "$SNAP")"
  undeclared_import=""
  if [ -z "$declared_pwtest" ]; then
    undeclared_import="$(grep -rlE "(from|require\()[[:space:]]*['\"]@playwright/test['\"]" "$SV" \
      --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.js' 2>/dev/null \
      | grep -v '/node_modules/' | grep -v '/.exemplar-harness/' | head -1)"
  fi
  if [ -n "$bad" ]; then
    a1_ok=0; a1_msg="playwright dependency diverges from the existing ${BASE_PW_VERSION} line (reinstalled a different version instead of reusing what is in package.json): $bad"
  elif [ -n "$undeclared_import" ]; then
    a1_ok=0; a1_msg="imports the undeclared '@playwright/test' package (the project ships only playwright@${BASE_PW_VERSION}; its runner is the 'playwright/test' subpath) — a toolchain-reuse violation, e.g. ${undeclared_import#"$ROOT/"}"
  else
    a1_ok=1; a1_msg="ok"
  fi
}

# ── run the submission's own playwright tests against the current client.tsx ──
# writes newline-separated "STATUS\tTITLE" to $1
# kill anything listening on $1 (best-effort; lsof where available)
free_port() {
  pids="$(lsof -ti tcp:"$1" 2>/dev/null)"
  [ -n "$pids" ] && kill $pids 2>/dev/null
  sleep 1
}
# stop the server started by run_suite: kill npm, its children (next-server), and free the port
stop_server() {
  [ -n "${SRV:-}" ] && { pkill -P "$SRV" 2>/dev/null; kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; }
  free_port "$PORT"
}

run_suite() {
  out="$1"
  # Seed the deterministic fixture session (identical for the buggy and fixed arms) BEFORE the
  # build. HOME must cover the BUILD as well as start: codespeak-vibe-share/config computes
  # CLAUDE_PROJECTS_DIR from os.homedir() at module-load time, which Next resolves during
  # `next build` and bakes in — so HOME-only-on-start freezes the projects dir to the build-time
  # HOME and the fixture is never read. Mirror the plan-badge exemplar's webServer, which sets
  # env.HOME across the whole `build && start` command.
  seed_fixture
  ( cd "$SV" && HOME="$FIXHOME" npm run build ) >/tmp/hn_build.log 2>&1
  if [ $? -ne 0 ]; then echo "__BUILD_FAILED__" > "$out"; return; fi
  free_port "$PORT"
  LOG="$(mktemp)"
  ( cd "$SV" && HOME="$FIXHOME" npm run start -- -p "$PORT" ) >"$LOG" 2>&1 &
  SRV=$!
  READY=0
  i=0; while [ $i -lt 60 ]; do
    if curl -s "http://localhost:$PORT/" -o /dev/null; then READY=1; break; fi
    sleep 1; i=$((i+1))
  done
  if [ "$READY" != 1 ]; then echo "__SERVER_FAILED__" > "$out"; stop_server; return; fi
  # run the submission's tests with its OWN config's testDir, but point baseURL at
  # our controlled server and disable any webServer block. JSON reporter to stdout.
  RES="$(mktemp)"
  ( cd "$SV" && SV_FIXTURE_HOME="$FIXHOME" PLAYWRIGHT_JSON_OUTPUT_NAME= \
      npx playwright test --config "$HARNESS/playwright.harness.config.ts" --reporter=json ) >"$RES" 2>/tmp/hn_pw.log
  stop_server
  node -e '
    const fs=require("fs");
    let j; try{ j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }catch(e){ process.stdout.write("__NO_JSON__\n"); process.exit(0); }
    const lines=[];
    const walk=(s)=>{ for(const sp of (s.suites||[])) walk(sp);
      for(const sp of (s.specs||[])){
        const t=sp.tests?.[0];
        const st = t? (t.status||t.results?.[0]?.status) : "unknown";
        // playwright: spec.ok true/false; status "expected"/"unexpected"/"skipped"/"flaky"
        let norm="unknown";
        if(sp.tests?.[0]?.results?.some(r=>r.status==="passed")) norm="passed";
        if(t && t.status==="skipped") norm="skipped";
        if(sp.ok===true && norm!=="skipped") norm="passed";
        if(sp.ok===false) norm="failed";
        lines.push(norm+"\t"+sp.title);
      }
    };
    walk(j);
    process.stdout.write(lines.join("\n")+"\n");
  ' "$RES" > "$out"
}

# ── Axis 2: discrimination ─────────────────────────────────────────────
axis2() {
  if [ ! -f "$HARNESS/client.buggy.tsx" ] || [ ! -f "$HARNESS/client.fixed.tsx" ]; then
    a2_msg="harness variant files missing"; return; fi
  if [ ! -f "$CLIENT" ]; then
    a2_msg="UNGRADABLE (harness): could not locate the submission's session-page client to swap the reference buggy/fixed variant into (tried the reference path and a content search for the scroll-to-target owner). This is a harness limitation for a restructured submission, NOT a 'tests do not reproduce the bug' result."; return; fi
  cp "$CLIENT" "$HARNESS/client.submitted.bak" 2>/dev/null
  BUG="$(mktemp)"; FIX="$(mktemp)"
  cp "$HARNESS/client.buggy.tsx" "$CLIENT"; run_suite "$BUG"
  cp "$HARNESS/client.fixed.tsx" "$CLIENT"; run_suite "$FIX"
  [ -f "$HARNESS/client.submitted.bak" ] && cp "$HARNESS/client.submitted.bak" "$CLIENT"
  if grep -q "__BUILD_FAILED__\|__SERVER_FAILED__\|__NO_JSON__" "$BUG" "$FIX"; then
    a2_msg="UNGRADABLE (harness): could not execute the submission's tests against the swapped reference client (build/server/json error). The submission likely restructured the session client so the reference buggy/fixed variant is not drop-in compatible (interface/props mismatch). This is a harness limitation, NOT a 'tests do not reproduce the bug' result — see logs."; return; fi
  # discrimination: some title failed on buggy AND passed on fixed
  disc="$(node -e '
    const fs=require("fs");
    const parse=(f)=>Object.fromEntries(fs.readFileSync(f,"utf8").trim().split("\n").filter(Boolean).map(l=>{const [s,...t]=l.split("\t");return [t.join("\t"),s];}));
    const b=parse(process.argv[1]), f=parse(process.argv[2]);
    const hits=[];
    for(const title of Object.keys(f)){
      if(b[title]==="failed" && f[title]==="passed") hits.push(title);
    }
    process.stdout.write(hits.length? "OK::"+hits.join(" | ") : "NONE");
  ' "$BUG" "$FIX")"
  echo "buggy results:"; cat "$BUG"; echo "fixed results:"; cat "$FIX"
  case "$disc" in
    OK::*) a2_ok=1; a2_msg="discriminating tests: ${disc#OK::}" ;;
    *) a2_ok=0; a2_msg="no submitted test fails on the buggy impl AND passes on the fixed impl (tests do not reproduce the bug)" ;;
  esac
}

axis1
axis2
emit_junit
[ "$a1_ok" = 1 ] && [ "$a2_ok" = 1 ]
