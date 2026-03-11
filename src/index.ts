#!/usr/bin/env node

import { program } from "commander";
import { run } from "./cli.js";
import { TOOL_VERSION } from "./config.js";

program
  .name("codespeak-vibe-share")
  .description(
    "Share your vibe-coded project and AI coding sessions with Codespeak",
  )
  .version(TOOL_VERSION)
  .option("--dry-run", "Show what would be included without creating archive")
  .option("--no-sessions", "Exclude AI coding sessions")
  .option("--output <path>", "Save zip locally instead of uploading")
  .option("--verbose", "Show detailed progress")
  .action(run);

program.parse();
