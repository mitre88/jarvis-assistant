import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { clipboardReadTool, clipboardWriteTool } from "../src/agent/tools/clipboard";
import { listDirTool, readFileTool, writeFileTool } from "../src/agent/tools/fs";
import { recallTool, rememberTool } from "../src/agent/tools/memory";
import { notifyTool } from "../src/agent/tools/notify";
import { openUrlTool } from "../src/agent/tools/open";
import { createStandardRegistry } from "../src/agent/tools";
import { runCommandTool } from "../src/agent/tools/shell";
import { fakeContext } from "./helpers";

function tempHome(): string {
  return mkdtempSync(path.join(tmpdir(), "jarvis-tools-"));
}

describe("filesystem tools", () => {
  const home = tempHome();
  after(() => rmSync(home, { recursive: true, force: true }));

  it("list_dir lists names with sizes", async () => {
    mkdirSync(path.join(home, "sub"));
    writeFileSync(path.join(home, "a.txt"), "hello");
    const out = await listDirTool.execute({ path: "~" }, fakeContext({ home }));
    assert.ok(out.includes("a.txt (5 B)"));
    assert.ok(out.includes("sub/"));
  });

  it("read_file returns content", async () => {
    const out = await readFileTool.execute({ path: "a.txt" }, fakeContext({ home }));
    assert.equal(out, "hello");
  });

  it("read_file refuses paths outside the sandbox", async () => {
    await assert.rejects(
      () => readFileTool.execute({ path: "/etc/passwd" }, fakeContext({ home })),
      /outside the allowed workspace/
    );
  });

  it("write_file asks for confirmation and writes on approval", async () => {
    const ctx = fakeContext({ home, approve: true });
    const out = await writeFileTool.execute(
      { path: "new/dir/file.txt", content: "data" },
      ctx
    );
    assert.equal(ctx.confirmRequests.length, 1);
    assert.match(ctx.confirmRequests[0]!.title, /Create file/);
    assert.match(out, /Wrote 4 B/);
    assert.equal(readFileSync(path.join(home, "new", "dir", "file.txt"), "utf8"), "data");
  });

  it("write_file does nothing when the user declines", async () => {
    const ctx = fakeContext({ home, approve: false });
    const out = await writeFileTool.execute({ path: "denied.txt", content: "x" }, ctx);
    assert.match(out, /declined/);
    assert.ok(!existsSync(path.join(home, "denied.txt")));
  });

  it("write_file flags overwrites in the confirmation", async () => {
    const ctx = fakeContext({ home, approve: true });
    await writeFileTool.execute({ path: "a.txt", content: "new" }, ctx);
    assert.match(ctx.confirmRequests[0]!.title, /Overwrite/);
  });
});

describe("run_command tool", () => {
  const home = tempHome();
  after(() => rmSync(home, { recursive: true, force: true }));

  it("runs read-only commands without confirmation", async () => {
    const ctx = fakeContext({ home });
    const out = await runCommandTool.execute({ command: "echo jarvis-online" }, ctx);
    assert.equal(ctx.confirmRequests.length, 0);
    assert.match(out, /exit code: 0/);
    assert.match(out, /jarvis-online/);
  });

  // `node -e` is not on the read-only allowlist, so it exercises the
  // confirmation path and works on Windows shells too.
  const writeCmd = (name: string) =>
    `node -e "require('fs').writeFileSync('${name}','x')"`;

  it("asks before running mutating commands and respects denial", async () => {
    const ctx = fakeContext({ home, approve: false });
    const out = await runCommandTool.execute(
      { command: writeCmd("should-not-exist.txt") },
      ctx
    );
    assert.equal(ctx.confirmRequests.length, 1);
    assert.match(out, /declined/);
    assert.ok(!existsSync(path.join(home, "should-not-exist.txt")));
  });

  it("runs mutating commands after approval, in the home cwd", async () => {
    const ctx = fakeContext({ home, approve: true });
    const out = await runCommandTool.execute({ command: writeCmd("created.txt") }, ctx);
    assert.match(out, /exit code: 0/);
    assert.ok(existsSync(path.join(home, "created.txt")));
  });

  it("kills commands that exceed the timeout", async () => {
    const ctx = fakeContext({ home, approve: true });
    const out = await runCommandTool.execute(
      { command: 'node -e "setTimeout(()=>{},5000)"', timeout_seconds: 0.3 },
      ctx
    );
    assert.match(out, /killed after 0.3s timeout/);
  });
});

describe("clipboard, memory, notify, open_url", () => {
  const home = tempHome();
  after(() => rmSync(home, { recursive: true, force: true }));

  it("clipboard round-trips text", async () => {
    const ctx = fakeContext({ home });
    await clipboardWriteTool.execute({ text: "copied" }, ctx);
    assert.equal(await clipboardReadTool.execute({}, ctx), "copied");
  });

  it("remember persists and recall filters", async () => {
    const ctx = fakeContext({ home });
    await rememberTool.execute({ note: "The user prefers tea." }, ctx);
    await rememberTool.execute({ note: "Backup drive is E:." }, ctx);
    const all = await recallTool.execute({}, ctx);
    assert.match(all, /tea/);
    assert.match(all, /Backup drive/);
    const filtered = await recallTool.execute({ query: "tea" }, ctx);
    assert.match(filtered, /tea/);
    assert.doesNotMatch(filtered, /Backup/);
  });

  it("notify goes through the injected notifier", async () => {
    const ctx = fakeContext({ home });
    await notifyTool.execute({ title: "Ping", body: "Done" }, ctx);
    assert.deepEqual(ctx.notifications, [{ title: "Ping", body: "Done" }]);
  });

  it("open_url accepts only http(s)", async () => {
    const ctx = fakeContext({ home });
    await openUrlTool.execute({ url: "https://example.com" }, ctx);
    assert.deepEqual(ctx.openedUrls, ["https://example.com/"]);
    await assert.rejects(
      () => openUrlTool.execute({ url: "file:///etc/passwd" }, ctx),
      /Only http\(s\)/
    );
  });
});

describe("tool registry", () => {
  const home = tempHome();
  after(() => rmSync(home, { recursive: true, force: true }));

  it("exposes all required tools", () => {
    const names = createStandardRegistry().specs().map((t) => t.name).sort();
    assert.deepEqual(names, [
      "clipboard_read",
      "clipboard_write",
      "datetime",
      "list_dir",
      "notify",
      "open_path",
      "open_url",
      "read_file",
      "recall",
      "remember",
      "run_command",
      "system_info",
      "write_file",
    ]);
  });

  it("captures tool errors instead of throwing", async () => {
    const registry = createStandardRegistry();
    const bad = await registry.execute("read_file", '{"path": "/etc/passwd"}', fakeContext({ home }));
    assert.ok(bad.isError);
    assert.match(bad.content, /outside the allowed workspace/);
    const unknown = await registry.execute("teleport", "{}", fakeContext({ home }));
    assert.ok(unknown.isError);
    const invalid = await registry.execute("read_file", "{oops", fakeContext({ home }));
    assert.ok(invalid.isError);
    assert.match(invalid.content, /Invalid JSON/);
  });
});
