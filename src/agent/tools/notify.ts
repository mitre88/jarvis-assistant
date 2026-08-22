import { optionalString, requireString } from "./args";
import type { ToolDef } from "./registry";

export const notifyTool: ToolDef = {
  name: "notify",
  description: "Show a native desktop notification.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Notification title." },
      body: { type: "string", description: "Optional notification body." },
    },
    required: ["title"],
  },
  async execute(args, ctx) {
    const title = requireString(args, "title");
    const body = optionalString(args, "body") ?? "";
    ctx.notify(title, body);
    return "Notification shown.";
  },
};
