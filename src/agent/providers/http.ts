/** Small HTTP helpers shared by all providers. Pure where possible, for tests. */

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<Response>;

/**
 * Normalize a user-supplied base URL: trim, drop trailing slashes and a
 * trailing "/v1" (people paste "https://api.groq.com/openai/v1"; endpoint
 * paths below always start with "/v1" or "/api").
 */
export function normalizeBaseUrl(raw: string, fallback: string): string {
  let base = raw.trim();
  if (base === "") base = fallback;
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  base = base.replace(/\/+$/, "");
  base = base.replace(/\/v1$/i, "");
  return base;
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 300);
    return text || res.statusText;
  } catch {
    return res.statusText;
  }
}

/** Iterate an SSE response, yielding each `data:` payload (excluding [DONE]). */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error("Empty response body");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") yield payload;
    }
  }
}

/** Iterate a newline-delimited-JSON response, yielding each parsed line. */
export async function* ndjson(res: Response): AsyncGenerator<unknown> {
  if (!res.body) throw new Error("Empty response body");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield JSON.parse(line);
    }
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest);
}
