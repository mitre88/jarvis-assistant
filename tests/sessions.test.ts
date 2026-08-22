import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { Msg } from "../src/agent/types";
import {
  SessionStore,
  messagesToBubbles,
  titleFromMessages,
} from "../src/main/sessions";

describe("session store", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-sessions-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("creates, lists, loads, and deletes sessions", () => {
    const store = new SessionStore(dir);
    const a = store.create("system-a");
    assert.equal(a.title, "New session");
    a.messages.push({ role: "user", content: "What is the time, Jarvis?" });
    store.save(a);
    assert.equal(store.load(a.id)?.title, "What is the time, Jarvis?");

    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, a.id);

    const latest = store.latest();
    assert.equal(latest?.id, a.id);

    store.delete(a.id);
    assert.equal(store.list().length, 0);
    assert.equal(store.load(a.id), null);
  });

  it("rejects unsafe ids", () => {
    const store = new SessionStore(dir);
    assert.throws(() => store.load("../escape"), /Invalid session id/);
  });

  it("derives titles and bubbles", () => {
    const messages: Msg[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "  hello   world  " },
      { role: "assistant", content: "Noted." },
      { role: "tool", toolCallId: "1", name: "datetime", content: "{}" },
      { role: "assistant", content: "" },
    ];
    assert.equal(titleFromMessages(messages), "hello world");
    const bubbles = messagesToBubbles(messages);
    assert.deepEqual(
      bubbles.map((b) => b.kind),
      ["user", "assistant", "tool"]
    );
  });
});
