import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { runAgent, type LoopEvent } from "../src/agent/loop";
import { ToolRegistry } from "../src/agent/tools/registry";
import { datetimeTool } from "../src/agent/tools/system";
import type { ChatProvider, Msg, StreamEvent } from "../src/agent/types";
import { fakeContext } from "./helpers";

/** A provider that replays scripted turns and records what it was sent. */
class ScriptedProvider implements ChatProvider {
  received: Msg[][] = [];
  constructor(private turns: StreamEvent[][]) {}

  async *chat(messages: Msg[]): AsyncGenerator<StreamEvent> {
    this.received.push(structuredClone(messages));
    const turn = this.turns.shift();
    assert.ok(turn, "provider called more times than scripted");
    yield* turn;
  }
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(datetimeTool);
  return registry;
}

describe("agent loop", () => {
  const home = mkdtempSync(path.join(tmpdir(), "jarvis-loop-"));
  after(() => rmSync(home, { recursive: true, force: true }));

  it("executes one tool call, feeds the result back, and finishes", async () => {
    const provider = new ScriptedProvider([
      [
        { type: "text", text: "Checking" },
        {
          type: "tool-calls",
          calls: [{ id: "call_1", name: "datetime", arguments: "{}" }],
        },
      ],
      [
        { type: "text", text: "It is " },
        { type: "text", text: "late, sir." },
      ],
    ]);
    const messages: Msg[] = [
      { role: "system", content: "test" },
      { role: "user", content: "time?" },
    ];
    const events: LoopEvent[] = [];

    const final = await runAgent({
      provider,
      messages,
      registry: makeRegistry(),
      ctx: fakeContext({ home }),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    assert.equal(final, "It is late, sir.");

    // Second provider call must include the assistant tool call and its result.
    const second = provider.received[1]!;
    const assistant = second[2]!;
    assert.equal(assistant.role, "assistant");
    assert.deepEqual((assistant as Extract<Msg, { role: "assistant" }>).toolCalls, [
      { id: "call_1", name: "datetime", arguments: "{}" },
    ]);
    const toolMsg = second[3]! as Extract<Msg, { role: "tool" }>;
    assert.equal(toolMsg.role, "tool");
    assert.equal(toolMsg.toolCallId, "call_1");
    assert.ok(toolMsg.content.includes("timezone"));

    // HUD events: tool call + result + streamed tokens.
    assert.ok(events.some((e) => e.type === "tool-call" && e.name === "datetime"));
    const result = events.find((e) => e.type === "tool-result");
    assert.ok(result && result.type === "tool-result" && !result.isError);
    const streamed = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    assert.ok(streamed.includes("It is late, sir."));
  });

  it("reports unknown tools back to the model instead of crashing", async () => {
    const provider = new ScriptedProvider([
      [{ type: "tool-calls", calls: [{ id: "c1", name: "nope", arguments: "{}" }] }],
      [{ type: "text", text: "My mistake." }],
    ]);
    const messages: Msg[] = [{ role: "user", content: "go" }];
    const events: LoopEvent[] = [];

    const final = await runAgent({
      provider,
      messages,
      registry: makeRegistry(),
      ctx: fakeContext({ home }),
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    assert.equal(final, "My mistake.");
    const result = events.find((e) => e.type === "tool-result");
    assert.ok(result && result.type === "tool-result" && result.isError);
  });

  it("stops at the tool iteration cap", async () => {
    const endless: StreamEvent[][] = Array.from({ length: 10 }, (_, i) => [
      {
        type: "tool-calls",
        calls: [{ id: `c${i}`, name: "datetime", arguments: "{}" }],
      },
    ]);
    const provider = new ScriptedProvider(endless);
    const messages: Msg[] = [{ role: "user", content: "loop forever" }];

    const final = await runAgent({
      provider,
      messages,
      registry: makeRegistry(),
      ctx: fakeContext({ home }),
      signal: new AbortController().signal,
      maxToolIterations: 3,
      onEvent: () => {},
    });

    assert.match(final, /iteration limit \(3\)/);
    // 4 provider turns: iterations 0..2 execute tools, turn 3 hits the cap.
    assert.equal(provider.received.length, 4);
  });
});
