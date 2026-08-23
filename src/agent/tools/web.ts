import { requireString } from "./args";
import type { ToolDef } from "./registry";
import { fetchPublicText, htmlToText } from "./http-safe";

const SEARCH_CAP = 5;

export const fetchUrlTool: ToolDef = {
  name: "fetch_url",
  readOnly: true,
  description:
    "Fetch an http(s) URL and return readable text (HTML stripped). Output is capped at 64 KB. Private/local addresses are blocked.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http:// or https:// URL." },
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    const raw = requireString(args, "url");
    const result = await fetchPublicText(raw, ctx);
    const type = result.contentType.toLowerCase();
    const body =
      type.includes("html") || type.includes("xml") ? htmlToText(result.text) : result.text.trim();
    const parts = [`Source: ${result.url}`, body || "(empty body)"];
    if (result.truncated) parts.push("… truncated at 64 KB");
    return parts.join("\n");
  },
};

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function decodeDdgHref(href: string): string {
  try {
    const abs = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(abs, "https://html.duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // fall through
  }
  return href;
}

/** Parse DuckDuckGo HTML-lite result cards. Exported for tests. */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < SEARCH_CAP * 2) {
    const url = decodeDdgHref(match[1] ?? "");
    const title = htmlToText(match[2] ?? "");
    if (!url || !title) continue;
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    const after = html.slice(match.index, match.index + 1200);
    const snipMatch = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = snipMatch ? htmlToText(snipMatch[1] ?? "") : "";
    hits.push({ title, url, snippet });
  }
  return hits.slice(0, SEARCH_CAP);
}

function parseDuckDuckGoJson(raw: string): SearchHit[] {
  try {
    const data = JSON.parse(raw) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const hits: SearchHit[] = [];
    if (data.AbstractText && data.AbstractURL) {
      hits.push({
        title: data.Heading || data.AbstractURL,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }
    for (const t of data.RelatedTopics ?? []) {
      if (hits.length >= SEARCH_CAP) break;
      if (t.FirstURL && t.Text) {
        hits.push({ title: t.Text.split(" - ")[0] ?? t.Text, url: t.FirstURL, snippet: t.Text });
      }
    }
    return hits;
  } catch {
    return [];
  }
}

export const webSearchTool: ToolDef = {
  name: "web_search",
  readOnly: true,
  description:
    "Search the public web (DuckDuckGo). Returns up to 5 results with title, URL, and snippet. No API key required. Follow up with fetch_url for a full page.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const query = requireString(args, "query");
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    let hits: SearchHit[] = [];
    try {
      const page = await fetchPublicText(htmlUrl, ctx);
      hits = parseDuckDuckGoHtml(page.text);
    } catch {
      // Instant-answer API as a fallback when the HTML endpoint is blocked.
    }
    if (hits.length === 0) {
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const page = await fetchPublicText(apiUrl, ctx);
      hits = parseDuckDuckGoJson(page.text);
    }
    if (hits.length === 0) {
      return `No web results for "${query}".`;
    }
    return hits
      .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet || "(no snippet)"}`)
      .join("\n");
  },
};
