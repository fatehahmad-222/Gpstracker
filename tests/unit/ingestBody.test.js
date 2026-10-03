import { describe, it, expect } from "vitest";

import { readBoundedJson } from "@/lib/server/ingest";
import { LIMITS } from "@/lib/monitor/ingest";

/** Minimal Request stand-in with a real stream, since the reader consumes it. */
function makeRequest(body, { contentLength } = {}) {
  const bytes = new TextEncoder().encode(body);
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return {
    headers,
    body: bytes.length
      ? new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        })
      : null,
  };
}

describe("readBoundedJson", () => {
  it("parses a normal body", async () => {
    const result = await readBoundedJson(makeRequest(JSON.stringify({ events: [{ type: "power_off" }] })));
    expect(result.error).toBeUndefined();
    expect(result.body.events[0].type).toBe("power_off");
  });

  it("parses a body split across chunks", async () => {
    const json = JSON.stringify({ pings: [{ lat: 1 }, { lat: 2 }] });
    const bytes = new TextEncoder().encode(json);
    const request = {
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 10));
          controller.enqueue(bytes.slice(10));
          controller.close();
        },
      }),
    };
    expect((await readBoundedJson(request)).body.pings).toHaveLength(2);
  });

  it("rejects an oversized body up front from content-length", async () => {
    // The cheap early exit: no point streaming something already known to be
    // too large.
    const request = makeRequest("{}", { contentLength: LIMITS.maxBatchBytes + 1 });
    expect((await readBoundedJson(request)).error).toBe("body_too_large");
  });

  it("rejects an oversized body with no content-length", async () => {
    // A chunked request lies by omission, so the running total has to catch it.
    const oversized = JSON.stringify({ events: "x".repeat(LIMITS.maxBatchBytes) });
    expect((await readBoundedJson(makeRequest(oversized))).error).toBe("body_too_large");
  });

  it("honours a custom lower cap", async () => {
    const request = makeRequest(JSON.stringify({ blob: "x".repeat(500) }));
    expect((await readBoundedJson(request, 100)).error).toBe("body_too_large");
  });

  it("treats an empty body as an empty object", async () => {
    expect((await readBoundedJson(makeRequest(""))).body).toEqual({});
    expect((await readBoundedJson({ headers: new Headers(), body: null })).body).toEqual({});
  });

  it("rejects malformed JSON", async () => {
    expect((await readBoundedJson(makeRequest("{not json"))).error).toBe("bad_json");
  });

  it("rejects JSON that is not an object", async () => {
    // A bare array or string is not a batch, and letting it through would make
    // `body.events` undefined for reasons that are hard to trace back.
    expect((await readBoundedJson(makeRequest("[1,2,3]"))).error).toBe("bad_json");
    expect((await readBoundedJson(makeRequest('"hello"'))).error).toBe("bad_json");
    expect((await readBoundedJson(makeRequest("null"))).error).toBe("bad_json");
  });
});
