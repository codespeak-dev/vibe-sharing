import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TmpProject {
  root: string;
  cleanup: () => Promise<void>;
}

export async function makeTmpProject(prefix = "vibe-test-"): Promise<TmpProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export async function writeFile(
  root: string,
  relPath: string,
  contents: string,
): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
}

export async function gitInit(root: string): Promise<void> {
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
    cwd: root,
  });
}

export async function gitCommitAll(root: string, message = "init"): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message],
    { cwd: root },
  );
}
