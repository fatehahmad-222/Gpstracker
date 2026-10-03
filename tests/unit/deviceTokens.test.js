import { describe, it, expect } from "vitest";

import { hashToken, safeEqual, mintToken, bearerToken } from "@/lib/server/ingest";

describe("hashToken", () => {
  it("is deterministic, so lookup can be an indexed equality match", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("produces 64 hex characters (sha256)", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the token itself", () => {
    // The whole point of hashing: a leaked device_tokens row must not be a
    // replayable credential.
    const token = mintToken();
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).not.toBe(token);
  });

  it("separates tokens that differ by one character", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("handles an empty string without throwing", () => {
    expect(hashToken("")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("mintToken", () => {
  it("produces a high-entropy token", () => {
    // 32 bytes base64url is 43 characters.
    expect(mintToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => mintToken()));
    expect(tokens.size).toBe(500);
  });

  it("produces a token safe to put in a header without escaping", () => {
    expect(mintToken()).not.toMatch(/[+/=]/);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings of the same length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch, which would itself leak the
    // length, so the length check happens first.
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});

describe("bearerToken", () => {
  function request(auth) {
    return { headers: new Headers(auth ? { authorization: auth } : {}) };
  }

  it("extracts a bearer token", () => {
    expect(bearerToken(request("Bearer abc123"))).toBe("abc123");
  });

  it("is case-insensitive about the scheme", () => {
    expect(bearerToken(request("bearer abc123"))).toBe("abc123");
    expect(bearerToken(request("BEARER abc123"))).toBe("abc123");
  });

  it("tolerates extra whitespace", () => {
    expect(bearerToken(request("  Bearer   abc123  "))).toBe("abc123");
  });

  it("returns null when the header is absent or malformed", () => {
    expect(bearerToken(request())).toBeNull();
    expect(bearerToken(request(""))).toBeNull();
    expect(bearerToken(request("abc123"))).toBeNull();
    expect(bearerToken(request("Basic abc123"))).toBeNull();
    expect(bearerToken(request("Bearer "))).toBeNull();
  });
});