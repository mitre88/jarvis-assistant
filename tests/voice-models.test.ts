import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";
import { ModelManager, modelUrl, WHISPER_MODELS } from "../src/main/voice/models";

function fakeFetch(
  chunks: Buffer[],
  opts: { status?: number; contentLength?: number } = {}
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: unknown) => {
    calls.push(String(url));
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name === "content-length" ? String(opts.contentLength ?? 0) : null,
      },
      body: status < 300 ? Readable.from(chunks) : null,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("whisper model catalog", () => {
  it("has unique ids and hugging face URLs", () => {
    const ids = WHISPER_MODELS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(modelUrl("base.en"), "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin");
  });
});

describe("ModelManager", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-models-"));

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("downloads atomically and reports progress", async () => {
    const payload = [Buffer.from("hello "), Buffer.from("world")];
    const { impl } = fakeFetch(payload, { contentLength: 11 });
    const manager = new ModelManager(dir, impl);

    const progress: number[] = [];
    const target = await manager.download("tiny.en", (p) => progress.push(p.received));

    assert.equal(readFileSync(target, "utf8"), "hello world");
    assert.ok(progress.length >= 1);
    assert.equal(progress[progress.length - 1], 11);
    assert.ok(manager.isDownloaded("tiny.en"));
    // No .part leftovers.
    assert.ok(readdirSync(dir).every((f) => !f.endsWith(".part")));
  });

  it("skips the network when the model is already on disk", async () => {
    const { impl, calls } = fakeFetch([Buffer.from("x")]);
    const manager = new ModelManager(dir, impl);
    await manager.download("tiny.en");
    assert.equal(calls.length, 0);
  });

  it("rejects unknown model ids", async () => {
    const { impl } = fakeFetch([]);
    const manager = new ModelManager(dir, impl);
    await assert.rejects(() => manager.download("not-a-model"), /Unknown whisper model/);
  });

  it("cleans up after a failed download", async () => {
    const { impl } = fakeFetch([], { status: 503 });
    const manager = new ModelManager(dir, impl);
    await assert.rejects(() => manager.download("base.en"), /HTTP 503/);
    assert.ok(!manager.isDownloaded("base.en"));
    assert.ok(readdirSync(dir).every((f) => !f.endsWith(".part")));
  });

  it("deletes a downloaded model", () => {
    const manager = new ModelManager(dir, fakeFetch([]).impl);
    assert.ok(manager.isDownloaded("tiny.en"));
    manager.delete("tiny.en");
    assert.ok(!manager.isDownloaded("tiny.en"));
    assert.ok(!existsSync(manager.pathFor("tiny.en")));
  });

  it("lists the catalog with download state", () => {
    const manager = new ModelManager(dir, fakeFetch([]).impl);
    const list = manager.list();
    assert.equal(list.length, WHISPER_MODELS.length);
    assert.ok(list.every((m) => typeof m.downloaded === "boolean"));
  });
});
