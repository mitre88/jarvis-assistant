import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { clipboardReadTool, clipboardWriteTool } from "../src/agent/tools/clipboard";
import {
  appendFileTool,
  deleteFileTool,
  listDirTool,
  moveFileTool,
  readFileTool,
  writeFileTool,
} from "../src/agent/tools/fs";
import { grepFilesTool } from "../src/agent/tools/grep";
import { recallTool, rememberTool, searchMemoryTool } from "../src/agent/tools/memory";
import { notifyTool } from "../src/agent/tools/notify";
import { openPathTool, openUrlTool } from "../src/agent/tools/open";
import { createStandardRegistry } from "../src/agent/tools";
import { runCommandTool } from "../src/agent/tools/shell";
import { fetchUrlTool, webSearchTool } from "../src/agent/tools/web";
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

  it("read_file pages with offset and limit", async () => {
    writeFileSync(path.join(home, "paged.txt"), "ABCDEFGHIJ");
    const slice = await readFileTool.execute(
      { path: "paged.txt", offset: 2, limit: 4 },
      fakeContext({ home })
    );
    assert.match(slice, /^CDEF/);
    assert.match(slice, /offset=6/);
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

  it("append_file appends after approval", async () => {
    const ctx = fakeContext({ home, approve: true });
    writeFileSync(path.join(home, "log.txt"), "hi");
    const out = await appendFileTool.execute({ path: "log.txt", content: " there" }, ctx);
    assert.match(out, /Appended/);
    assert.equal(readFileSync(path.join(home, "log.txt"), "utf8"), "hi there");
  });

  it("delete_file refuses directories and respects denial", async () => {
    mkdirSync(path.join(home, "keep-dir"));
    await assert.rejects(
      () => deleteFileTool.execute({ path: "keep-dir" }, fakeContext({ home, approve: true })),
      /directory/
    );
    writeFileSync(path.join(home, "doomed.txt"), "x");
    const denied = await deleteFileTool.execute(
      { path: "doomed.txt" },
      fakeContext({ home, approve: false })
    );
    assert.match(denied, /declined/);
    assert.ok(existsSync(path.join(home, "doomed.txt")));
    const ok = await deleteFileTool.execute(
      { path: "doomed.txt" },
      fakeContext({ home, approve: true })
    );
    assert.match(ok, /Deleted/);
    assert.ok(!existsSync(path.join(home, "doomed.txt")));
  });

  it("move_file relocates after approval", async () => {
    writeFileSync(path.join(home, "src.txt"), "cargo");
    const ctx = fakeContext({ home, approve: true });
    const out = await moveFileTool.execute({ from: "src.txt", to: "dest/out.txt" }, ctx);
    assert.match(out, /Moved/);
    assert.ok(!existsSync(path.join(home, "src.txt")));
    assert.equal(readFileSync(path.join(home, "dest", "out.txt"), "utf8"), "cargo");
  });

  it("grep_files finds a line under the workspace", async () => {
    writeFileSync(path.join(home, "needle.txt"), "alpha\nfind-me-please\nomega\n");
    const out = await grepFilesTool.execute(
      { query: "find-me", path: "~" },
      fakeContext({ home })
    );
    assert.match(out, /needle\.txt/);
    assert.match(out, /find-me-please/);
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

  it("kills an in-flight command when the abort signal fires", async () => {
    const ac = new AbortController();
    const ctx = fakeContext({ home, approve: true, signal: ac.signal });
    const pending = runCommandTool.execute(
      { command: 'node -e "setTimeout(()=>{},5000)"', timeout_seconds: 8 },
      ctx
    );
    setTimeout(() => ac.abort(), 80);
    const out = await pending;
    assert.match(out, /Cancelled by the user/);
  });
});

describe("clipboard, memory, notify, open_url", () => {
  const home = tempHome();
  after(() => rmSync(home, { recursive: true, force: true }));

  it("clipboard round-trips text after approval", async () => {
    const ctx = fakeContext({ home, approve: true });
    await clipboardWriteTool.execute({ text: "copied" }, ctx);
    assert.equal(ctx.confirmRequests.length, 1);
    assert.equal(await clipboardReadTool.execute({}, ctx), "copied");
  });

  it("clipboard_write does nothing when declined", async () => {
    const ctx = fakeContext({ home, approve: false, clipboardText: "keep" });
    const out = await clipboardWriteTool.execute({ text: "overwrite" }, ctx);
    assert.match(out, /declined/);
    assert.equal(ctx.clipboardText, "keep");
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
    const ranked = await searchMemoryTool.execute({ query: "tea" }, ctx);
    assert.match(ranked, /tea/);
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

  it("open_path asks before opening an executable", async () => {
    const exe = path.join(home, "payload.sh");
    writeFileSync(exe, "#!/bin/sh\necho hi\n");
    const denied = fakeContext({ home, approve: false });
    const out = await openPathTool.execute({ path: "payload.sh" }, denied);
    assert.match(out, /declined/);
    assert.equal(denied.openedPaths.length, 0);
  });

  it("fetch_url blocks private targets and reads public text via injected fetch", async () => {
    await assert.rejects(
      () => fetchUrlTool.execute({ url: "http://127.0.0.1/secret" }, fakeContext({ home })),
      /Blocked host/
    );
    const ctx = fakeContext({
      home,
      fetch: async () =>
        new Response("<html><body><p>Hello from the web</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const out = await fetchUrlTool.execute({ url: "https://example.com/page" }, ctx);
    assert.match(out, /Hello from the web/);
    assert.match(out, /example.com/);
  });

  it("web_search parses injected DuckDuckGo HTML", async () => {
    const html = `
      <a class="result__a" href="https://example.org/a">Alpha</a>
      <a class="result__snippet">First hit</a>
    `;
    const ctx = fakeContext({
      home,
      fetch: async () =>
        new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    });
    const out = await webSearchTool.execute({ query: "jarvis" }, ctx);
    assert.match(out, /Alpha/);
    assert.match(out, /example.org/);
  });
});

describe("tool registry", () => {
  const home = tempHome();
  after(() => rmSync(home, { recursive: true, force: true }));

  it("exposes all required tools", () => {
    const names = createStandardRegistry().specs().map((t) => t.name).sort();
    assert.deepEqual(names, [
      "append_file",
      "clipboard_read",
      "clipboard_write",
      "datetime",
      "delete_file",
      "fetch_url",
      "grep_files",
      "list_dir",
      "move_file",
      "notify",
      "open_path",
      "open_url",
      "read_file",
      "recall",
      "remember",
      "run_command",
      "search_memory",
      "system_info",
      "web_search",
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
