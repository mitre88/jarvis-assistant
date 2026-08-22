/**
 * SSRF-aware HTTP helper for fetch_url / web_search.
 * Blocks private, loopback, link-local, and metadata addresses.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { ToolContext } from "./context";
import { getFetch, throwIfAborted } from "./context";

const blocks = new BlockList();
blocks.addSubnet("0.0.0.0", 8, "ipv4");
blocks.addSubnet("10.0.0.0", 8, "ipv4");
blocks.addSubnet("127.0.0.0", 8, "ipv4");
blocks.addSubnet("169.254.0.0", 16, "ipv4");
blocks.addSubnet("172.16.0.0", 12, "ipv4");
blocks.addSubnet("192.168.0.0", 16, "ipv4");
blocks.addAddress("::1", "ipv6");
blocks.addSubnet("fc00::", 7, "ipv6");
blocks.addSubnet("fe80::", 10, "ipv6");
blocks.addSubnet("::ffff:0.0.0.0", 104, "ipv6");

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_CAP_BYTES = 64 * 1024;
export const MAX_REDIRECTS = 3;

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return blocks.check(ip, "ipv4");
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::ffff:")) {
      const mapped = ip.slice(ip.lastIndexOf(":") + 1);
      if (isIP(mapped) === 4) return isPrivateIp(mapped);
    }
    return blocks.check(ip, "ipv6");
  }
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) && isPrivateIp(host)) return true;
  return false;
}

export async function assertSafeHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`Blocked host: ${url.hostname}`);
  }
  const version = isIP(url.hostname.replace(/^\[|\]$/g, ""));
  if (version === 0) {
    let addresses: { address: string }[];
    try {
      addresses = await lookup(url.hostname, { all: true });
    } catch {
      throw new Error(`Could not resolve host: ${url.hostname}`);
    }
    for (const a of addresses) {
      if (isPrivateIp(a.address)) {
        throw new Error(`Blocked: ${url.hostname} resolves to a private address.`);
      }
    }
  }
  return url;
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|.*\+(json|xml))/i;

export function isTextContentType(contentType: string): boolean {
  if (!contentType) return true;
  return TEXT_TYPES.test(contentType.split(";")[0]!.trim());
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FetchPublicResult {
  url: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

function combineSignals(ctx: ToolContext, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!ctx.signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([ctx.signal, timeout]);
  }
  return ctx.signal.aborted ? ctx.signal : timeout;
}

export async function fetchPublicText(
  raw: string,
  ctx: ToolContext,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<FetchPublicResult> {
  throwIfAborted(ctx);
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? FETCH_CAP_BYTES;
  const fetchImpl = getFetch(ctx);

  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeHttpUrl(current);
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: combineSignals(ctx, timeoutMs),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.1",
        "User-Agent": "Jarvis/0.2 (desktop assistant)",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect with no Location (${res.status})`);
      current = new URL(location, url).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url.hostname}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!isTextContentType(contentType)) {
      throw new Error(`Not a text resource (${contentType || "unknown type"})`);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const slice = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return {
      url: url.toString(),
      contentType,
      text,
      truncated: buf.byteLength > maxBytes,
    };
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
}
