/**
 * Path sandbox. Every filesystem tool resolves paths through here.
 * A path is allowed only if it stays inside one of the allowed roots,
 * after normalization and symlink resolution of existing ancestors.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export class SandboxViolation extends Error {
  constructor(requested: string) {
    super(`Path is outside the allowed workspace: ${requested}`);
    this.name = "SandboxViolation";
  }
}

function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

/** Resolve symlinks on the deepest existing ancestor so links can't escape. */
function realCanonical(p: string): string {
  let current = p;
  let suffix = "";
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), suffix);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, suffix);
      suffix = path.join(path.basename(current), suffix);
      current = parent;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a user/model-supplied path against `home`, expand `~`, and verify
 * it falls inside one of `roots`. Throws SandboxViolation otherwise.
 * Returns the absolute (canonical) path to use for the actual fs operation.
 */
export function resolveSafe(requested: string, roots: string[], home: string): string {
  const expanded = expandHome(requested.trim(), home);
  const absolute = path.resolve(home, expanded);
  const canonical = realCanonical(absolute);
  for (const root of roots) {
    const canonicalRoot = realCanonical(path.resolve(root));
    if (isWithin(canonicalRoot, canonical)) return canonical;
  }
  throw new SandboxViolation(requested);
}
