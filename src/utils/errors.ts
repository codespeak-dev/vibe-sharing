export class VibeError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly suggestion?: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = "VibeError";
  }
}

export function gitNotFound(): VibeError {
  return new VibeError(
    "Git is not installed or not in PATH.",
    "Install git from https://git-scm.com or ensure it's in your PATH.",
  );
}

export function notAGitRepo(): VibeError {
  return new VibeError(
    "This directory is not a git repository.",
    "Project files will be collected using exclude patterns instead.",
  );
}

export function noSessionsFound(): VibeError {
  return new VibeError(
    "No AI coding sessions found for this project.",
    "You can browse for session files manually, or proceed without sessions.",
  );
}

export function networkError(cause: unknown): VibeError {
  return new VibeError(
    "Could not reach the upload server.",
    "Check your internet connection, or use --output to save the zip locally.\nRun with --verbose for details.",
    { cause },
  );
}

export function uploadFailed(step: string, cause: unknown): VibeError {
  return new VibeError(
    `Upload failed at ${step} step.`,
    "Try again, or use --output to save the zip locally.\nRun with --verbose for details.",
    { cause },
  );
}

export function archiveTooLarge(sizeMB: number, limitMB: number): VibeError {
  return new VibeError(
    `Archive is ${(sizeMB / 1024).toFixed(1)}GB, which exceeds the ${limitMB / 1024}GB limit.`,
    "Consider excluding large files or directories.",
  );
}

export function permissionDenied(filePath: string, cause: unknown): VibeError {
  return new VibeError(
    `Permission denied reading ${filePath}.`,
    "Check file permissions and try again.",
    { cause },
  );
}
