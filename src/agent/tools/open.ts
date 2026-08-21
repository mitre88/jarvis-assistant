import { requireString } from "./args";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

export const openUrlTool: ToolDef = {
  name: "open_url",
  description: "Open an http(s) URL in the user's default browser.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http:// or https:// URL." },
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    const raw = requireString(args, "url");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Not a valid URL: ${raw}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Only http(s) URLs may be opened, got ${url.protocol}`);
    }
    await ctx.openExternal(url.toString());
    return `Opened ${url.toString()} in the default browser.`;
  },
};

export const openPathTool: ToolDef = {
  name: "open_path",
  description:
    "Open a file or folder inside the user's workspace with the OS default application.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or folder path. Supports ~ for home." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const p = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const error = await ctx.openPath(p);
    if (error) throw new Error(error);
    return `Opened ${p} with the default handler.`;
  },
};
