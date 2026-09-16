import { readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Directories and files always excluded from context discovery, read_file,
 * search_files, and plan fingerprinting. These cannot be disabled by the user
 * or by .gitignore.
 */
const PROTECTED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".parcel-cache",
  ".svelte-kit",
  ".cache",
  ".vortex",
  ".codex",
  ".agents",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".eggs",
  ".nuxt",
  ".output",
  ".gradle",
  ".idea",
  ".vscode-test",
]);

const PROTECTED_FILE_PATTERNS = [
  /\.env(\..+)?$/i,
  /\.vsix$/i,
  /\.pyc$/i,
  /\.pyo$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.DS_Store$/i,
  /Thumbs\.db$/i,
];

/**
 * Default exclusion globs used by list_files and search_files.
 * These are always active and combined with user-provided patterns.
 */
const defaultExcludeGlobs = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".parcel-cache",
  ".svelte-kit",
  ".cache",
  ".vortex",
  ".codex",
  ".agents",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".eggs",
  "*.egg-info",
  ".nuxt",
  ".output",
  ".gradle",
  ".idea",
  ".vscode-test",
  ".env",
  ".env.*",
  "*.vsix",
  "*.pyc",
  "*.pyo",
  "*.pem",
  "*.key",
  ".DS_Store",
  "Thumbs.db",
].map((name) => `**/${name}/**`);

/**
 * Check if a relative path is inside a protected directory.
 * Used by safeReadPath to block read_file from accessing node_modules, etc.
 */
export function isContextProtected(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  for (const part of parts) {
    if (PROTECTED_DIRS.has(part)) return true;
    if (part.startsWith(".env.")) return true;
  }
  const base = path.basename(relativePath);
  return PROTECTED_FILE_PATTERNS.some((re) => re.test(base));
}

/**
 * Read .gitignore from the workspace root and return non-comment,
 * non-empty patterns as glob exclusions.
 */
export async function readGitignore(root: string): Promise<string[]> {
  try {
    const content = await readFile(path.join(root, ".gitignore"), "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .filter((line) => !line.startsWith("!")) // negations not supported as exclusions
      .map((line) => {
        // Normalize gitignore patterns to glob patterns
        let pattern = line.replace(/\/$/, ""); // trailing slash = directory
        if (pattern.startsWith("/")) pattern = pattern.slice(1);
        return `**/${pattern}/**`;
      });
  } catch {
    return [];
  }
}

/**
 * Build the combined exclusion glob string from default exclusions,
 * .gitignore patterns, and user-provided patterns.
 */
export async function buildExclusionGlob(
  root: string,
  userPatterns: string[] = [],
): Promise<string> {
  const gitignorePatterns = await readGitignore(root);
  const all = [...defaultExcludeGlobs, ...gitignorePatterns, ...userPatterns];
  return "{" + [...new Set(all)].join(",") + "}";
}

/**
 * Synchronous version using only default + user patterns (no .gitignore).
 * Used when async is not available or for backward compatibility.
 */
export function exclusionGlobSync(patterns: string[] = []): string {
  const all = [...defaultExcludeGlobs, ...patterns];
  return "{" + [...new Set(all)].join(",") + "}";
}

export { defaultExcludeGlobs };
