import * as fs from "node:fs/promises";
import * as path from "node:path";
import { requireString } from "./args";
import { throwIfAborted } from "./context";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

const EXEC_EXT = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".ps1",
  ".sh",
  ".bash",
  ".zsh",
  ".command",
  ".app",
  ".bin",
  ".run",
  ".apk",
  ".scr",
  ".vbs",
]);

async function looksExecutable(p: string): Promise<boolean> {
  const ext = path.extname(p).toLowerCase();
  if (EXEC_EXT.has(ext)) return true;
  try {
    const st = await fs.stat(p);
    if (st.isDirectory()) return false;
    if ((st.mode & 0o111) !== 0) return true;
  } catch {
    return false;
  }
  return false;
}

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
    throwIfAborted(ctx);
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
    "Open a file or folder inside the user's workspace with the OS default application. Executables require approval.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or folder path. Supports ~ for home." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const p = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    if (await looksExecutable(p)) {
      const approved = await ctx.confirm({
        title: "Open executable?",
        detail: p,
      });
      if (!approved) return "The user declined to open the executable. Do not retry unless asked.";
    }
    throwIfAborted(ctx);
    const error = await ctx.openPath(p);
    if (error) throw new Error(error);
    return `Opened ${p} with the default handler.`;
  },
};
