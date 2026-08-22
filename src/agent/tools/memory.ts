/** Durable notes Jarvis keeps for the user, stored as a small JSON file. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { optionalNumber, optionalString, requireString } from "./args";
import { throwIfAborted } from "./context";
import type { ToolDef } from "./registry";

interface MemoryNote {
  ts: string;
  text: string;
}

const MAX_NOTES = 500;

async function loadNotes(file: string): Promise<MemoryNote[]> {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8")) as { notes?: MemoryNote[] };
    return Array.isArray(data.notes) ? data.notes : [];
  } catch {
    return [];
  }
}

async function saveNotes(file: string, notes: MemoryNote[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ notes }, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function formatNotes(notes: MemoryNote[]): string {
  return notes.map((n) => `[${n.ts.slice(0, 10)}] ${n.text}`).join("\n");
}

/** Newest notes first, for injection into the system context. */
export async function recentNotesText(file: string, limit = 12): Promise<string> {
  const notes = await loadNotes(file);
  return formatNotes(notes.slice().reverse().slice(0, limit));
}

export const rememberTool: ToolDef = {
  name: "remember",
  description:
    "Store a short durable note the user asked to keep (preferences, facts, reminders). Survives restarts.",
  parameters: {
    type: "object",
    properties: {
      note: { type: "string", description: "The note to remember, one concise sentence." },
    },
    required: ["note"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const note = requireString(args, "note");
    const notes = await loadNotes(ctx.memoryFile);
    notes.push({ ts: new Date().toISOString(), text: note });
    if (notes.length > MAX_NOTES) notes.splice(0, notes.length - MAX_NOTES);
    await saveNotes(ctx.memoryFile, notes);
    return `Noted. (${notes.length} notes on file)`;
  },
};

export const recallTool: ToolDef = {
  name: "recall",
  readOnly: true,
  description:
    "Retrieve stored notes, newest first. Optionally filter by a case-insensitive substring.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional substring to filter notes." },
    },
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const query = optionalString(args, "query")?.toLowerCase();
    const notes = await loadNotes(ctx.memoryFile);
    const matches = (query ? notes.filter((n) => n.text.toLowerCase().includes(query)) : notes)
      .slice()
      .reverse();
    if (matches.length === 0) {
      return query ? `No notes matching "${query}".` : "No notes on file.";
    }
    return formatNotes(matches);
  },
};

export const searchMemoryTool: ToolDef = {
  name: "search_memory",
  readOnly: true,
  description:
    "Search durable notes ranked by recency (newest first). Prefer this when looking for a specific fact instead of dumping every note.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring to match (case-insensitive)." },
      limit: { type: "number", description: "Max notes to return (default 20, max 50)." },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    throwIfAborted(ctx);
    const query = requireString(args, "query").toLowerCase();
    const limit = Math.min(optionalNumber(args, "limit") ?? 20, 50);
    const notes = await loadNotes(ctx.memoryFile);
    const matches = notes
      .filter((n) => n.text.toLowerCase().includes(query))
      .reverse()
      .slice(0, limit);
    if (matches.length === 0) return `No notes matching "${query}".`;
    return formatNotes(matches);
  },
};
