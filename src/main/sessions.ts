/**
 * Persisted conversations. Each session is a JSON file under userData/sessions.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Msg } from "../agent/types";
import type { ChatBubble, SessionMeta, SessionView } from "../shared/types";

export interface SessionRecord extends SessionMeta {
  messages: Msg[];
}

const ID_RE = /^[a-zA-Z0-9-]+$/;

export function titleFromMessages(messages: Msg[]): string {
  const user = messages.find((m) => m.role === "user");
  if (!user || user.role !== "user") return "New session";
  const t = user.content.replace(/\s+/g, " ").trim();
  if (!t) return "New session";
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

export function messagesToBubbles(messages: Msg[]): ChatBubble[] {
  const out: ChatBubble[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") out.push({ kind: "user", content: m.content });
    else if (m.role === "assistant" && m.content.trim()) {
      out.push({ kind: "assistant", content: m.content });
    } else if (m.role === "tool") {
      out.push({ kind: "tool", content: m.content, name: m.name });
    }
  }
  return out;
}

export function toSessionView(record: SessionRecord): SessionView {
  return {
    id: record.id,
    title: record.title,
    updatedAt: record.updatedAt,
    messages: messagesToBubbles(record.messages),
  };
}

export class SessionStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error("Invalid session id");
    return path.join(this.dir, `${id}.json`);
  }

  list(): SessionMeta[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8")) as SessionRecord;
        if (raw.id && raw.title && raw.updatedAt) {
          metas.push({ id: raw.id, title: raw.title, updatedAt: raw.updatedAt });
        }
      } catch {
        // skip corrupt files
      }
    }
    metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return metas;
  }

  load(id: string): SessionRecord | null {
    if (!ID_RE.test(id)) throw new Error("Invalid session id");
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(id), "utf8")) as SessionRecord;
      if (!raw.id || !Array.isArray(raw.messages)) return null;
      return raw;
    } catch {
      return null;
    }
  }

  save(record: SessionRecord): void {
    const next: SessionRecord = {
      ...record,
      title: titleFromMessages(record.messages),
      updatedAt: new Date().toISOString(),
    };
    record.title = next.title;
    record.updatedAt = next.updatedAt;
    const dest = this.file(next.id);
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, dest);
  }

  delete(id: string): void {
    try {
      fs.unlinkSync(this.file(id));
    } catch {
      // already gone
    }
  }

  create(systemPrompt: string): SessionRecord {
    const rec: SessionRecord = {
      id: randomUUID(),
      title: "New session",
      updatedAt: new Date().toISOString(),
      messages: [{ role: "system", content: systemPrompt }],
    };
    this.save(rec);
    return rec;
  }

  latest(): SessionRecord | null {
    const first = this.list()[0];
    return first ? this.load(first.id) : null;
  }
}
