import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_HEADER, upsertMemoryMessage } from "../src/agent/memory-context";
import type { Msg } from "../src/agent/types";

describe("memory context", () => {
  it("inserts a notes block after the persona system prompt", () => {
    const messages: Msg[] = [
      { role: "system", content: "You are Jarvis." },
      { role: "user", content: "hello" },
    ];
    upsertMemoryMessage(messages, "[today] prefers tea");
    assert.equal(messages[1]?.role, "system");
    assert.match((messages[1] as { content: string }).content, new RegExp(MEMORY_HEADER));
    assert.match((messages[1] as { content: string }).content, /prefers tea/);
    assert.equal(messages[2]?.role, "user");
  });

  it("replaces an existing notes block and removes it when empty", () => {
    const messages: Msg[] = [
      { role: "system", content: "You are Jarvis." },
      { role: "system", content: `${MEMORY_HEADER} (newest first):\nold` },
      { role: "user", content: "hi" },
    ];
    upsertMemoryMessage(messages, "fresh");
    assert.equal(messages.filter((m) => m.role === "system").length, 2);
    assert.match((messages[1] as { content: string }).content, /fresh/);
    upsertMemoryMessage(messages, "");
    assert.equal(messages.filter((m) => m.role === "system").length, 1);
    assert.equal(messages[1]?.role, "user");
  });
});
