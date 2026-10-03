import { describe, it, expect } from "vitest";
import {
  hashAppPassword,
  verifyAppPassword,
  needsRehash,
  generateAppPassword,
} from "@/lib/monitor/password";
import { passwordChecklist } from "@/lib/monitor/validation";

describe("hashAppPassword", () => {
  it("never stores the plaintext", () => {
    const stored = hashAppPassword("secret123");
    expect(stored).not.toContain("secret123");
  });

  it("produces a self-describing scrypt hash", () => {
    expect(hashAppPassword("secret123")).toMatch(/^scrypt\$/);
  });

  it("salts each hash independently", () => {
    expect(hashAppPassword("secret123")).not.toBe(hashAppPassword("secret123"));
  });

  it("handles a non-ascii password", () => {
    expect(() => hashAppPassword("پاس ورڈ")).not.toThrow();
  });
});

describe("verifyAppPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyAppPassword("secret123", hashAppPassword("secret123"))).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyAppPassword("wrong", hashAppPassword("secret123"))).toBe(false);
  });

  it("is case sensitive", () => {
    expect(verifyAppPassword("SECRET123", hashAppPassword("secret123"))).toBe(false);
  });

  it("rejects an empty password against a real hash", () => {
    expect(verifyAppPassword("", hashAppPassword("secret123"))).toBe(false);
  });

  it("rejects a null or undefined stored value", () => {
    expect(verifyAppPassword("secret123", null)).toBe(false);
    expect(verifyAppPassword("secret123", undefined)).toBe(false);
  });

  it("rejects an unrecognised hash format instead of throwing", () => {
    expect(verifyAppPassword("secret123", "plaintext-secret123")).toBe(false);
    expect(verifyAppPassword("secret123", "")).toBe(false);
    expect(verifyAppPassword("secret123", "scrypt$broken")).toBe(false);
  });

  it("does not throw on a malformed hash body", () => {
    expect(() => verifyAppPassword("secret123", "scrypt$16384$8$1$aaaa$bbbb")).not.toThrow();
  });

  it("rejects a tampered digest", () => {
    const stored = hashAppPassword("secret123");
    const parts = stored.split("$");
    parts[parts.length - 1] = "0".repeat(parts[parts.length - 1].length);
    expect(verifyAppPassword("secret123", parts.join("$"))).toBe(false);
  });
});

describe("needsRehash", () => {
  it("does not flag a current hash", () => {
    expect(needsRehash(hashAppPassword("secret123"))).toBe(false);
  });

  it("flags a missing hash", () => {
    expect(needsRehash(null)).toBe(true);
    expect(needsRehash(undefined)).toBe(true);
    expect(needsRehash("")).toBe(true);
  });

  it("flags a legacy non-scrypt hash", () => {
    expect(needsRehash("sha256$abc")).toBe(true);
  });
});

describe("generateAppPassword", () => {
  it("always satisfies the form's own password rules", () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generateAppPassword();
      const failed = passwordChecklist(password).filter((r) => !r.ok);
      if (failed.length) {
        throw new Error(`generated password failed ${failed.map((f) => f.key).join(", ")}: ${password}`);
      }
    }
  });

  it("honours a requested length, with a floor", () => {
    expect(generateAppPassword(16)).toHaveLength(16);
    expect(generateAppPassword(20)).toHaveLength(20);
    // Never shorter than the 8-character rule.
    expect(generateAppPassword(4)).toHaveLength(12);
  });

  it("avoids characters that are ambiguous when written on paper", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateAppPassword()).not.toMatch(/[lI1O0S5Z2B8]/);
    }
  });

  it("does not repeat itself across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateAppPassword()));
    expect(seen.size).toBe(50);
  });

  it("produces a password that verifies against its own hash", () => {
    const password = generateAppPassword();
    expect(verifyAppPassword(password, hashAppPassword(password))).toBe(true);
  });

  it("does not always place the same classes in the same positions", () => {
    const firstChars = new Set(Array.from({ length: 60 }, () => generateAppPassword()[0]));
    expect(firstChars.size).toBeGreaterThan(3);
  });
});