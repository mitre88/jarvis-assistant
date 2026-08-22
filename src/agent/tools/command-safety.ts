/**
 * Heuristic classification of shell commands. Anything not provably
 * read-only requires explicit user confirmation. The allowlist is the
 * whole policy: unknown commands are treated as mutating by default.
 */

const READ_ONLY = new Set([
  "ls", "dir", "pwd", "cd", "whoami", "hostname", "date", "uptime", "echo",
  "cat", "head", "tail", "wc", "sort", "uniq", "cut", "grep", "rg", "which",
  "where", "uname", "df", "du", "ps", "env", "printenv", "type", "file",
  "stat", "tree", "history", "id", "printf", "basename", "dirname",
]);

const GIT_READ_ONLY = new Set([
  "status", "log", "diff", "show", "branch", "remote", "blame", "shortlog",
]);

export type CommandClass = "safe" | "needs-confirmation";

/** Split on shell control operators so each simple command is checked. */
function segments(command: string): string[] {
  return command
    .split(/(?:\|\|?|&&|;|\n)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function segmentIsSafe(segment: string): boolean {
  // Redirects can create or truncate files; substitution can hide anything.
  if (/[><]|\$\(|`/.test(segment)) return false;
  const tokens = segment.split(/\s+/);
  const cmd = (tokens[0] ?? "").toLowerCase();
  if (cmd === "git") {
    const sub = (tokens[1] ?? "").toLowerCase();
    return GIT_READ_ONLY.has(sub);
  }
  if (cmd === "find") {
    return !tokens.some((t) => t === "-delete" || t === "-exec" || t === "-execdir");
  }
  return READ_ONLY.has(cmd);
}

export function classifyCommand(command: string): CommandClass {
  const parts = segments(command);
  if (parts.length === 0) return "needs-confirmation";
  return parts.every(segmentIsSafe) ? "safe" : "needs-confirmation";
}
