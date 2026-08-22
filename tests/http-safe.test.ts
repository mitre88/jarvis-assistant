import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeHttpUrl,
  htmlToText,
  isBlockedHostname,
  isPrivateIp,
  isTextContentType,
} from "../src/agent/tools/http-safe";
import { parseDuckDuckGoHtml } from "../src/agent/tools/web";

describe("http-safe", () => {
  it("flags loopback and RFC1918 addresses", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("10.0.0.4"), true);
    assert.equal(isPrivateIp("192.168.1.10"), true);
    assert.equal(isPrivateIp("172.16.5.1"), true);
    assert.equal(isPrivateIp("169.254.169.254"), true);
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("::1"), true);
  });

  it("blocks localhost hostnames", () => {
    assert.equal(isBlockedHostname("localhost"), true);
    assert.equal(isBlockedHostname("foo.localhost"), true);
    assert.equal(isBlockedHostname("printer.local"), true);
    assert.equal(isBlockedHostname("127.0.0.1"), true);
    assert.equal(isBlockedHostname("example.com"), false);
  });

  it("rejects file, private IP, and credentialed URLs without DNS", async () => {
    await assert.rejects(() => assertSafeHttpUrl("file:///etc/passwd"), /Only http/);
    await assert.rejects(() => assertSafeHttpUrl("http://127.0.0.1/"), /Blocked host/);
    await assert.rejects(() => assertSafeHttpUrl("http://localhost/admin"), /Blocked host/);
    await assert.rejects(
      () => assertSafeHttpUrl("https://user:pass@example.com/"),
      /credentials/
    );
  });

  it("accepts a well-formed public URL", async () => {
    const url = await assertSafeHttpUrl("https://example.com/path");
    assert.equal(url.hostname, "example.com");
  });

  it("strips HTML to text", () => {
    assert.equal(htmlToText("<p>Hello <b>sir</b></p>"), "Hello sir");
    assert.ok(!htmlToText("<script>alert(1)</script>hi").includes("alert"));
  });

  it("classifies text content types", () => {
    assert.equal(isTextContentType("text/html; charset=utf-8"), true);
    assert.equal(isTextContentType("application/json"), true);
    assert.equal(isTextContentType("image/png"), false);
  });
});

describe("duckduckgo html parser", () => {
  it("extracts title, decoded uddg URL, and snippet", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example Title</a>
      <a class="result__snippet">A short blurb about the page.</a>
    `;
    const hits = parseDuckDuckGoHtml(html);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.title, "Example Title");
    assert.equal(hits[0]!.url, "https://example.com/page");
    assert.match(hits[0]!.snippet, /short blurb/);
  });
});
