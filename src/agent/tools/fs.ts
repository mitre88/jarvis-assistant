import * as fs from "node:fs/promises";
import * as path from "node:path";
import { requireString } from "./args";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

const READ_CAP_BYTES = 256 * 1024;
const LIST_CAP_ENTRIES = 500;

export const listDirTool: ToolDef = {
  name: "list_dir",
  description:
    "List a directory inside the user's workspace (home directory by default). Returns names, types, and sizes.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path. Supports ~ for home." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const dir = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines: string[] = [];
    for (const e of entries.slice(0, LIST_CAP_ENTRIES)) {
      if (e.isDirectory()) {
        lines.push(`${e.name}/`);
      } else {
        let size = "";
        try {
          size = ` (${(await fs.stat(path.join(dir, e.name))).size} B)`;
        } catch {
          // unreadable entry; list the name anyway
        }
        lines.push(`${e.name}${size}`);
      }
    }
    if (entries.length > LIST_CAP_ENTRIES) {
      lines.push(`… ${entries.length - LIST_CAP_ENTRIES} more entries omitted`);
    }
    return lines.length > 0 ? lines.join("\n") : "(empty directory)";
  },
};

export const readFileTool: ToolDef = {
  name: "read_file",
  description:
    "Read a text file inside the user's workspace. Output is capped at 256 KB.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path. Supports ~ for home." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const file = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const stat = await fs.stat(file);
    if (stat.size > READ_CAP_BYTES) {
      const fh = await fs.open(file, "r");
      try {
        const buf = Buffer.alloc(READ_CAP_BYTES);
        await fh.read(buf, 0, READ_CAP_BYTES, 0);
        return `${buf.toString("utf8")}\n… truncated (${stat.size} B total)`;
      } finally {
        await fh.close();
      }
    }
    return await fs.readFile(file, "utf8");
  },
};

export const writeFileTool: ToolDef = {
  name: "write_file",
  description:
    "Write a text file inside the user's workspace. The user must approve every write; creating parent directories is automatic.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path. Supports ~ for home." },
      content: { type: "string", description: "Full file content to write." },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const file = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const content = requireString(args, "content");
    let exists = true;
    try {
      await fs.access(file);
    } catch {
      exists = false;
    }
    const approved = await ctx.confirm({
      title: exists ? "Overwrite file?" : "Create file?",
      detail: `${file} (${Buffer.byteLength(content, "utf8")} B)`,
    });
    if (!approved) return "The user declined the write. Do not retry unless asked.";
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
    return `Wrote ${Buffer.byteLength(content, "utf8")} B to ${file}`;
  },
};
