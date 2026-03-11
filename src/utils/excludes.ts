/**
 * Default exclude patterns for non-git projects.
 * These are directories and file patterns that are almost never useful to share.
 */

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".vercel",
  ".netlify",
  "coverage",
  ".nyc_output",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "target", // Rust, Java
  "vendor", // Go, PHP
  ".gradle",
  ".idea",
  ".vscode",
  "Pods", // iOS
  ".dart_tool",
  ".pub-cache",
]);

const EXCLUDED_FILE_PATTERNS = [
  /^\.env($|\.)/, // .env, .env.local, .env.production, etc.
  /^\.DS_Store$/,
  /^Thumbs\.db$/,
  /^desktop\.ini$/,
  /\.pyc$/,
  /\.pyo$/,
  /\.class$/,
  /\.o$/,
  /\.so$/,
  /\.dylib$/,
  /\.dll$/,
  /\.exe$/,
  /\.log$/,
  /\.lock$/, // package-lock.json, yarn.lock, etc. — large, not useful
  /^npm-debug\.log/,
  /^yarn-error\.log/,
  /^pnpm-debug\.log/,
];

/**
 * Check if a path should be excluded based on default patterns.
 */
export function shouldExcludeDefault(
  relativePath: string,
  isDirectory: boolean,
): boolean {
  const name = relativePath.split("/").pop() ?? relativePath;

  if (isDirectory) {
    return EXCLUDED_DIRS.has(name);
  }

  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Get a human-readable list of default exclude patterns for display.
 */
export function getDefaultExcludeDescription(): string[] {
  const dirs = Array.from(EXCLUDED_DIRS)
    .sort()
    .map((d) => `${d}/`);
  const files = [
    ".env, .env.*",
    "*.pyc, *.pyo, *.class, *.o, *.so, *.dylib, *.dll, *.exe",
    "*.log, *.lock",
    ".DS_Store, Thumbs.db",
  ];
  return [...dirs, ...files];
}
