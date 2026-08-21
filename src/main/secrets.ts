/**
 * API key storage. Encrypted with Electron's safeStorage (Keychain on macOS,
 * DPAPI on Windows, libsecret on Linux) and kept in the untracked userData
 * dir. If the OS offers no encryption backend, the key is stored base64-only
 * and `plaintext` is flagged so the UI can warn.
 */
import { safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

interface SecretFile {
  encrypted: boolean;
  data: string;
}

export class SecretStore {
  private file: string;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "secret.json");
  }

  get plaintext(): boolean {
    return !safeStorage.isEncryptionAvailable();
  }

  setApiKey(key: string): void {
    if (key === "") {
      fs.rmSync(this.file, { force: true });
      return;
    }
    const record: SecretFile = safeStorage.isEncryptionAvailable()
      ? { encrypted: true, data: safeStorage.encryptString(key).toString("base64") }
      : { encrypted: false, data: Buffer.from(key, "utf8").toString("base64") };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(record), { mode: 0o600 });
  }

  getApiKey(): string {
    let record: SecretFile;
    try {
      record = JSON.parse(fs.readFileSync(this.file, "utf8")) as SecretFile;
    } catch {
      return "";
    }
    try {
      return record.encrypted
        ? safeStorage.decryptString(Buffer.from(record.data, "base64"))
        : Buffer.from(record.data, "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  hasApiKey(): boolean {
    return this.getApiKey() !== "";
  }
}
