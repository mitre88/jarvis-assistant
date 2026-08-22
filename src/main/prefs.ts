/** Non-secret preferences, persisted as JSON in Electron's userData dir. */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Settings } from "../shared/types";
import { PROVIDER_DEFAULTS } from "../agent/providers";

export const DEFAULT_MAX_TOOL_ITERATIONS = 8;

export function clampIterations(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_TOOL_ITERATIONS;
  return Math.min(32, Math.max(1, Math.round(v)));
}

export function normalizeRoots(roots: unknown): string[] {
  if (!Array.isArray(roots)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of roots) {
    if (typeof r !== "string") continue;
    const trimmed = r.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
  model: "",
  organization: "",
  extraHeaders: {},
  tts: false,
  maxToolIterations: DEFAULT_MAX_TOOL_ITERATIONS,
  extraRoots: [],
};

export class PrefsStore {
  private file: string;
  private settings: Settings;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "settings.json");
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...raw,
        maxToolIterations: clampIterations(raw.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS),
        extraRoots: normalizeRoots(raw.extraRoots),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  get(): Settings {
    return {
      ...this.settings,
      extraRoots: [...this.settings.extraRoots],
      extraHeaders: { ...this.settings.extraHeaders },
    };
  }

  set(update: Settings): void {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...update,
      maxToolIterations: clampIterations(update.maxToolIterations),
      extraRoots: normalizeRoots(update.extraRoots),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }
}
