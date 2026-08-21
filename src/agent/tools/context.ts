/**
 * Capabilities injected into tools. The main process wires real Electron
 * implementations; tests inject fakes. Tools never import electron directly.
 */

export interface ConfirmRequestInput {
  title: string;
  detail: string;
}

export interface ToolContext {
  /** Directories filesystem tools may touch. */
  roots: string[];
  home: string;
  /** Path of the durable memory JSON file. */
  memoryFile: string;
  /** Ask the user to approve a sensitive action. Resolves false on deny. */
  confirm(req: ConfirmRequestInput): Promise<boolean>;
  clipboard: {
    readText(): string;
    writeText(text: string): void;
  };
  openExternal(url: string): Promise<void>;
  /** Open a file/folder with the OS default handler. "" means success. */
  openPath(p: string): Promise<string>;
  notify(title: string, body: string): void;
}
