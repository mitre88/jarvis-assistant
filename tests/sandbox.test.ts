import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { resolveSafe, SandboxViolation } from "../src/agent/tools/sandbox";

describe("path sandbox", () => {
  const home = mkdtempSync(path.join(tmpdir(), "jarvis-home-"));
  const outside = mkdtempSync(path.join(tmpdir(), "jarvis-outside-"));
  const roots = [home];

  after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("accepts a relative path inside home", () => {
    assert.equal(resolveSafe("docs/notes.txt", roots, home), path.join(home, "docs", "notes.txt"));
  });

  it("accepts ~ expansion", () => {
    assert.equal(resolveSafe("~/notes.txt", roots, home), path.join(home, "notes.txt"));
  });

  it("accepts the root itself", () => {
    assert.equal(resolveSafe("~", roots, home), home);
  });

  it("rejects .. traversal out of home", () => {
    assert.throws(() => resolveSafe("../secrets", roots, home), SandboxViolation);
    assert.throws(() => resolveSafe("docs/../../../etc/passwd", roots, home), SandboxViolation);
  });

  it("rejects absolute paths outside all roots", () => {
    assert.throws(() => resolveSafe("/etc/passwd", roots, home), SandboxViolation);
    assert.throws(() => resolveSafe(outside, roots, home), SandboxViolation);
  });

  it("normalizes .. that stays inside home", () => {
    assert.equal(
      resolveSafe("docs/../notes.txt", roots, home),
      path.join(home, "notes.txt")
    );
  });

  it("rejects symlinks pointing outside the roots", () => {
    writeFileSync(path.join(outside, "target.txt"), "x");
    symlinkSync(path.join(outside, "target.txt"), path.join(home, "sneaky.txt"));
    assert.throws(() => resolveSafe("sneaky.txt", roots, home), SandboxViolation);
  });

  it("allows extra allowlisted roots", () => {
    const extra = path.join(outside, "shared");
    mkdirSync(extra);
    const resolved = resolveSafe(path.join(extra, "file.txt"), [home, extra], home);
    assert.ok(resolved.endsWith(path.join("shared", "file.txt")));
  });
});
