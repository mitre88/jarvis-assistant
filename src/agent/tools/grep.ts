import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { optionalNumber, optionalString, requireString } from "./args";
import { throwIfAborted } from "./context";
import type { ToolDef } from "./registry";
import { resolveSafe } from "./sandbox";

const HIT_CAP = 50;
const FILE_CAP = 2_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".npm",
  ".nvm",
  ".Trash",
  "Library",
  "AppData",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".mp3",
  ".mp4",
  ".mov",
  ".wav",
]);

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

function runRg(
  query: string,
  root: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "rg",
      [
        "-n",
        "--max-count",
        "3",
        "-m",
        String(HIT_CAP),
        "--max-filesize",
        "1M",
        "-g",
        "!node_modules",
        "-g",
        "!.git",
        "--color",
        "never",
        "--",
        query,
        root,
      ],
      { windowsHide: true }
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code === 0 || code === 1) resolve(output);
      else resolve(null);
    });
  });
}

async function walkNode(
  root: string,
  query: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<GrepHit[]> {
  const needle = query.toLowerCase();
  const hits: GrepHit[] = [];
  const started = Date.now();
  let scanned = 0;

  async function walk(dir: string): Promise<void> {
    if (hits.length >= HIT_CAP) return;
    if (Date.now() - started > timeoutMs) return;
    if (signal?.aborted) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= HIT_CAP || scanned >= FILE_CAP) return;
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (BINARY_EXT.has(path.extname(e.name).toLowerCase())) continue;
      scanned += 1;
      let text: string;
      try {
        const buf = await fs.readFile(full);
        if (buf.includes(0)) continue;
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      let perFile = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.toLowerCase().includes(needle)) {
          hits.push({ file: full, line: i + 1, text: line.trim().slice(0, 240) });
          perFile += 1;
          if (hits.length >= HIT_CAP || perFile >= 3) break;
        }
      }
    }
  }

  await walk(root);
  return hits;
}

export const grepFilesTool: ToolDef = {
  name: "grep_files",
  readOnly: true,
  description:
    "Search file contents under a workspace directory. Prefer a narrow folder over the whole home directory. Returns up to 50 hits. Uses ripgrep when available.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Case-insensitive substring to find." },
      path: {
        type: "string",
        description: "Directory to search (must be inside the workspace). Defaults to home.",
      },
      timeout_seconds: { type: "number", description: "Timeout in seconds (default 15, max 30)." },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const query = requireString(args, "query");
    const pathArg = optionalString(args, "path");
    const root = pathArg ? resolveSafe(pathArg, ctx.roots, ctx.home) : ctx.home;
    const timeoutMs = Math.min((optionalNumber(args, "timeout_seconds") ?? 15) * 1000, 30_000);

    const rg = await runRg(query, root, timeoutMs, ctx.signal);
    if (rg !== null) {
      const lines = rg
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, HIT_CAP);
      if (lines.length === 0) return `No matches for "${query}" under ${root}.`;
      return lines.join("\n");
    }

    const hits = await walkNode(root, query, timeoutMs, ctx.signal);
    throwIfAborted(ctx);
    if (hits.length === 0) return `No matches for "${query}" under ${root}.`;
    return hits.map((h) => `${h.file}:${h.line}:${h.text}`).join("\n");
  },
};
