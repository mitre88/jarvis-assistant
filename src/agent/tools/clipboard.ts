import { requireString } from "./args";
import type { ToolDef } from "./registry";

const READ_CAP_CHARS = 32 * 1024;

export const clipboardReadTool: ToolDef = {
  name: "clipboard_read",
  description: "Read the current text content of the system clipboard.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    const text = ctx.clipboard.readText();
    if (!text) return "(clipboard is empty or not text)";
    return text.length > READ_CAP_CHARS
      ? `${text.slice(0, READ_CAP_CHARS)}\n… truncated`
      : text;
  },
};

export const clipboardWriteTool: ToolDef = {
  name: "clipboard_write",
  description: "Replace the system clipboard with the given text.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to place on the clipboard." },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    const text = requireString(args, "text");
    ctx.clipboard.writeText(text);
    return `Copied ${text.length} characters to the clipboard.`;
  },
};
