import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countTurns, trimMessages, truncateToolContent } from "../src/agent/context-trim";
import type { Msg } from "../src/agent/types";

describe("context trim", () => {
  it("clips oversized tool results", () => {
    const big = "x".repeat(9000);
    const out = truncateToolContent(big);
    assert.ok(out.length < big.length);
    assert.match(out, /truncated for context/);
  });

  it("keeps system messages and the last N user turns", () => {
    const messages: Msg[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 5; i++) {
      messages.push({ role: "user", content: `u${i}` });
      messages.push({ role: "assistant", content: `a${i}` });
    }
    const trimmed = trimMessages(messages, 2);
    assert.equal(trimmed[0]?.role, "system");
    assert.equal(countTurns(trimmed), 2);
    const users = trimmed.filter((m) => m.role === "user").map((m) => m.content);
    assert.deepEqual(users, ["u3", "u4"]);
  });

  it("truncates tool contents on the wire copy only", () => {
    const original: Msg[] = [
      { role: "system", content: "s" },
      { role: "user", content: "read it" },
      {
        role: "tool",
        toolCallId: "1",
        name: "read_file",
        content: "y".repeat(9000),
      },
    ];
    const trimmed = trimMessages(original, 16);
    const tool = trimmed.find((m) => m.role === "tool");
    assert.ok(tool && tool.role === "tool");
    assert.ok(tool.content.length < 9000);
    const origTool = original[2];
    assert.ok(origTool && origTool.role === "tool");
    assert.equal(origTool.content.length, 9000);
  });
});
