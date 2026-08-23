import * as path from "node:path";
import type { ToolContext } from "../src/agent/tools/context";

export interface FakeContextOptions {
  home: string;
  approve?: boolean;
  clipboardText?: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export interface FakeContext extends ToolContext {
  confirmRequests: { title: string; detail: string }[];
  notifications: { title: string; body: string }[];
  openedUrls: string[];
  openedPaths: string[];
  clipboardText: string;
}

export function fakeContext(opts: FakeContextOptions): FakeContext {
  const ctx: FakeContext = {
    roots: [opts.home],
    home: opts.home,
    memoryFile: path.join(opts.home, "memory.json"),
    signal: opts.signal,
    fetch: opts.fetch,
    confirmRequests: [],
    notifications: [],
    openedUrls: [],
    openedPaths: [],
    clipboardText: opts.clipboardText ?? "",
    async confirm(req) {
      ctx.confirmRequests.push(req);
      return opts.approve ?? true;
    },
    clipboard: {
      readText: () => ctx.clipboardText,
      writeText: (text) => {
        ctx.clipboardText = text;
      },
    },
    async openExternal(url) {
      ctx.openedUrls.push(url);
    },
    async openPath(p) {
      ctx.openedPaths.push(p);
      return "";
    },
    notify(title, body) {
      ctx.notifications.push({ title, body });
    },
  };
  return ctx;
}
