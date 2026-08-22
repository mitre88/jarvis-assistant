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
  /** Cancel the current agent run. Tools should stop promptly when aborted. */
  signal?: AbortSignal;
  /** Overridable fetch (tests inject a stub). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

export function getFetch(ctx: ToolContext): typeof globalThis.fetch {
  return ctx.fetch ?? globalThis.fetch;
}

export function throwIfAborted(ctx: ToolContext): void {
  if (ctx.signal?.aborted) {
    throw new Error("Cancelled by the user.");
  }
}
