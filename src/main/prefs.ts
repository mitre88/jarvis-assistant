/** Non-secret preferences, persisted as JSON in Electron's userData dir. */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Settings } from "../shared/types";
import { PROVIDER_DEFAULTS } from "../agent/providers";

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
  model: "",
  organization: "",
  extraHeaders: {},
  tts: false,
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
      return { ...DEFAULT_SETTINGS, ...raw };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  get(): Settings {
    return { ...this.settings };
  }

  set(update: Settings): void {
    this.settings = { ...DEFAULT_SETTINGS, ...update };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }
}
