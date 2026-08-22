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

export function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 8_000);
  }
  return Math.min(300 * 2 ** attempt, 4_000);
}

export function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function defaultDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Retry transient provider failures (429 / 5xx / network) before the body is
 * consumed. Streaming responses are only retried when the status itself fails.
 */
export function withRetries(
  fetchImpl: FetchLike,
  opts?: {
    retries?: number;
    delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  }
): FetchLike {
  const retries = opts?.retries ?? 3;
  const delay = opts?.delay ?? defaultDelay;
  return async (url, init) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (init.signal?.aborted) throw init.signal.reason ?? new Error("Aborted");
      try {
        const res = await fetchImpl(url, init);
        if (res.ok || !shouldRetryStatus(res.status) || attempt === retries - 1) {
          return res;
        }
        await delay(retryDelayMs(attempt, res.headers.get("retry-after")), init.signal);
      } catch (err) {
        lastErr = err;
        if (init.signal?.aborted) throw err;
        if (attempt === retries - 1) throw err;
        await delay(retryDelayMs(attempt), init.signal);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Provider request failed");
  };
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
