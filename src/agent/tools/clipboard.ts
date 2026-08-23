import { requireString } from "./args";
import { throwIfAborted } from "./context";
import type { ToolDef } from "./registry";

const READ_CAP_CHARS = 32 * 1024;

export const clipboardReadTool: ToolDef = {
  name: "clipboard_read",
  readOnly: true,
  description: "Read the current text content of the system clipboard.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    throwIfAborted(ctx);
    const text = ctx.clipboard.readText();
    if (!text) return "(clipboard is empty or not text)";
    return text.length > READ_CAP_CHARS
      ? `${text.slice(0, READ_CAP_CHARS)}\n… truncated`
      : text;
  },
};

export const clipboardWriteTool: ToolDef = {
  name: "clipboard_write",
  description: "Replace the system clipboard with the given text. Requires approval.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to place on the clipboard." },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const text = requireString(args, "text");
    const preview = text.length > 200 ? `${text.slice(0, 200)}… (${text.length} chars)` : text;
    const approved = await ctx.confirm({
      title: "Replace clipboard?",
      detail: preview,
    });
    if (!approved) return "The user declined the clipboard write. Do not retry unless asked.";
    throwIfAborted(ctx);
    ctx.clipboard.writeText(text);
    return `Copied ${text.length} characters to the clipboard.`;
  },
};
