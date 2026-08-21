/** Durable notes Jarvis keeps for the user, stored as a small JSON file. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { optionalString, requireString } from "./args";
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
  description:
    "Retrieve stored notes. Optionally filter by a case-insensitive substring.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional substring to filter notes." },
    },
  },
  async execute(args, ctx) {
    const query = optionalString(args, "query")?.toLowerCase();
    const notes = await loadNotes(ctx.memoryFile);
    const matches = query
      ? notes.filter((n) => n.text.toLowerCase().includes(query))
      : notes;
    if (matches.length === 0) {
      return query ? `No notes matching "${query}".` : "No notes on file.";
    }
    return matches
      .map((n) => `[${n.ts.slice(0, 10)}] ${n.text}`)
      .join("\n");
  },
};
