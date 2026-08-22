import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retryDelayMs, shouldRetryStatus, withRetries, type FetchLike } from "../src/agent/providers/http";

describe("provider retries", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      if (n < 3) return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
      return new Response("ok", { status: 200 });
    };
    const wrapped = withRetries(fetchImpl, { retries: 3, delay: async () => {} });
    const res = await wrapped("https://example.com", { method: "POST", headers: {} });
    assert.equal(res.status, 200);
    assert.equal(n, 3);
  });

  it("does not retry ordinary 4xx", async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      return new Response("no", { status: 400 });
    };
    const wrapped = withRetries(fetchImpl, { retries: 3, delay: async () => {} });
    const res = await wrapped("https://example.com", { method: "GET", headers: {} });
    assert.equal(res.status, 400);
    assert.equal(n, 1);
  });

  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      if (n === 1) throw new Error("socket hang up");
      return new Response("ok", { status: 200 });
    };
    const wrapped = withRetries(fetchImpl, { retries: 3, delay: async () => {} });
    const res = await wrapped("https://example.com", { method: "GET", headers: {} });
    assert.equal(res.status, 200);
    assert.equal(n, 2);
  });

  it("classifies retryable statuses and caps delay", () => {
    assert.equal(shouldRetryStatus(429), true);
    assert.equal(shouldRetryStatus(503), true);
    assert.equal(shouldRetryStatus(404), false);
    assert.equal(retryDelayMs(0, "1"), 1000);
    assert.ok(retryDelayMs(8) <= 4000);
  });
});
