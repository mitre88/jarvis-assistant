import * as fs from "node:fs/promises";
import * as path from "node:path";
import { optionalNumber, requireString } from "./args";
import { throwIfAborted } from "./context";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

const READ_CAP_BYTES = 256 * 1024;
const LIST_CAP_ENTRIES = 500;

export const listDirTool: ToolDef = {
  name: "list_dir",
  readOnly: true,
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
    throwIfAborted(ctx);
    const dir = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const slice = entries.slice(0, LIST_CAP_ENTRIES);
    const lines = await Promise.all(
      slice.map(async (e) => {
        if (e.isDirectory()) return `${e.name}/`;
        try {
          const size = (await fs.stat(path.join(dir, e.name))).size;
          return `${e.name} (${size} B)`;
        } catch {
          return e.name;
        }
      })
    );
    if (entries.length > LIST_CAP_ENTRIES) {
      lines.push(`… ${entries.length - LIST_CAP_ENTRIES} more entries omitted`);
    }
    return lines.length > 0 ? lines.join("\n") : "(empty directory)";
  },
};

export const readFileTool: ToolDef = {
  name: "read_file",
  readOnly: true,
  description:
    "Read a text file inside the user's workspace. Output is capped at 256 KB. Use offset/limit to page through larger files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path. Supports ~ for home." },
      offset: { type: "number", description: "Byte offset to start reading (default 0)." },
      limit: { type: "number", description: "Max bytes to return (default 256 KB, max 256 KB)." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const file = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const offset = Math.max(0, Math.floor(optionalNumber(args, "offset") ?? 0));
    const limit = Math.min(
      Math.max(1, Math.floor(optionalNumber(args, "limit") ?? READ_CAP_BYTES)),
      READ_CAP_BYTES
    );
    const stat = await fs.stat(file);
    if (offset >= stat.size) {
      return `(offset ${offset} is past end of file, ${stat.size} B)`;
    }
    const toRead = Math.min(limit, stat.size - offset);
    const fh = await fs.open(file, "r");
    try {
      const buf = Buffer.alloc(toRead);
      await fh.read(buf, 0, toRead, offset);
      const text = buf.toString("utf8");
      const end = offset + toRead;
      if (end < stat.size) {
        return `${text}\n… truncated (${end}/${stat.size} B; pass offset=${end} to continue)`;
      }
      return offset > 0 ? `${text}\n… end of file (${stat.size} B)` : text;
    } finally {
      await fh.close();
    }
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
    throwIfAborted(ctx);
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
    throwIfAborted(ctx);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
    return `Wrote ${Buffer.byteLength(content, "utf8")} B to ${file}`;
  },
};

export const appendFileTool: ToolDef = {
  name: "append_file",
  description:
    "Append text to a file inside the workspace (creates the file if needed). Requires approval.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path. Supports ~ for home." },
      content: { type: "string", description: "Text to append." },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const file = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const content = requireString(args, "content");
    const approved = await ctx.confirm({
      title: "Append to file?",
      detail: `${file} (+${Buffer.byteLength(content, "utf8")} B)`,
    });
    if (!approved) return "The user declined the append. Do not retry unless asked.";
    throwIfAborted(ctx);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, content, "utf8");
    return `Appended ${Buffer.byteLength(content, "utf8")} B to ${file}`;
  },
};

export const deleteFileTool: ToolDef = {
  name: "delete_file",
  description:
    "Delete a file (not a directory) inside the workspace. Requires approval. Refuses directories.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path. Supports ~ for home." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const file = resolveSafe(requireString(args, "path"), ctx.roots, ctx.home);
    const stat = await fs.stat(file);
    if (stat.isDirectory()) {
      throw new Error("Refusing to delete a directory. Use a more specific file path.");
    }
    const approved = await ctx.confirm({
      title: "Delete file?",
      detail: `${file} (${stat.size} B)`,
    });
    if (!approved) return "The user declined the delete. Do not retry unless asked.";
    throwIfAborted(ctx);
    await fs.unlink(file);
    return `Deleted ${file}`;
  },
};

export const moveFileTool: ToolDef = {
  name: "move_file",
  description:
    "Move or rename a file inside the workspace. Requires approval. Refuses directories.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source file path." },
      to: { type: "string", description: "Destination file path." },
    },
    required: ["from", "to"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const src = resolveSafe(requireString(args, "from"), ctx.roots, ctx.home);
    const dest = resolveSafe(requireString(args, "to"), ctx.roots, ctx.home);
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      throw new Error("Refusing to move a directory.");
    }
    let destExists = false;
    try {
      await fs.access(dest);
      destExists = true;
    } catch {
      destExists = false;
    }
    const approved = await ctx.confirm({
      title: destExists ? "Move and overwrite?" : "Move file?",
      detail: `${src}\n→ ${dest}`,
    });
    if (!approved) return "The user declined the move. Do not retry unless asked.";
    throwIfAborted(ctx);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    return `Moved ${src} → ${dest}`;
  },
};
