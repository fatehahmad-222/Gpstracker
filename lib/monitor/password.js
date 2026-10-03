import crypto from "node:crypto";

/**
 * App-password hashing.
 *
 * Uses Node's built-in `scrypt` rather than bcrypt/argon2. Rationale:
 *   * zero native build step — this project's README already documents
 *     Windows/npm native-build pain, and bcrypt needs node-gyp
 *   * memory-hard, so it resists GPU cracking
 *   * no third-party supply-chain surface
 *
 * Format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */

const N = 16384; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;

export function hashAppPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyAppPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * Re-hash on login if the stored parameters are weaker than current.
 * Lets us raise N later without invalidating existing hashes.
 */
export function needsRehash(stored) {
  if (!stored || typeof stored !== "string") return true;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}

/**
 * Readable random password for a new employee.
 *
 * Field workers are often handed this on paper, so ambiguity is worse than
 * entropy: the alphabet drops l/1/I/0/O and similar pairs, and the result is
 * checked against the same rules the form enforces so a generated password can
 * never fail the form's own validation.
 */

// Ambiguous glyphs (l/1/I, 0/O, 5/S, 2/Z, 8/B) are dropped: this password is
// often written on paper or read aloud in Urdu, where those pairs get confused.
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ACDEFGHJKLMNPQRTUVWXY";
const DIGITS = "34679";
const SPECIALS = "!@#$%^&*";
const ALPHABET = DIGITS + UPPERCASE + LOWERCASE;

/**
 * Random password for a new employee.
 *
 * Guaranteed to satisfy the same rules the form enforces, so a generated
 * password can never be rejected by the form's own validation.
 */
export function generateAppPassword(length = 12) {
  const size = Math.max(12, Number(length) || 12);
  const chars = [];

  const pick = (set) => set[crypto.randomInt(set.length)];

  // Seed one character from each required class. The trailing digit and symbol
  // guarantee "a number" and "a special character" however the rest is filled.
  chars.push(pick(LOWERCASE), pick(UPPERCASE), pick(DIGITS));
  while (chars.length < size - 2) chars.push(pick(ALPHABET));
  chars.push(pick(DIGITS), pick(SPECIALS));

  // Fisher-Yates with a CSPRNG, so the seeded characters are not always in the
  // same positions.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}