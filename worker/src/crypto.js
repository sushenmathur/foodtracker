// Pure crypto helpers for the auth Worker: base32, TOTP (RFC 6238),
// PBKDF2 password hashing, and HS256 JWTs. Uses WebCrypto (globalThis.crypto),
// which exists in Cloudflare Workers and Node 18+. No Node-only APIs, so this
// file is unit-testable under plain Node.

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const enc = new TextEncoder();

// ---- base64url ----
function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ---- base32 (RFC 4648, no padding) ----
export function base32Decode(input) {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
export function randomBase32(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += B32_ALPHABET[b % 32];
  return out;
}

// ---- HOTP / TOTP (RFC 4226 / 6238, SHA-1, 6 digits) ----
async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}
async function hotp(keyBytes, counter, digits = 6) {
  const buf = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hs = await hmacSha1(keyBytes, buf);
  const offset = hs[hs.length - 1] & 0x0f;
  const bin =
    ((hs[offset] & 0x7f) << 24) |
    ((hs[offset + 1] & 0xff) << 16) |
    ((hs[offset + 2] & 0xff) << 8) |
    (hs[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}
export async function totp(secretBase32, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const counter = Math.floor(time / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}
// Verify with a ±`window` step tolerance for clock drift.
export async function verifyTotp(secretBase32, code, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
  if (!code || !/^\d{6}$/.test(code.trim())) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(time / 1000 / step);
  const target = code.trim();
  for (let w = -window; w <= window; w++) {
    if ((await hotp(key, counter + w, digits)) === target) return true;
  }
  return false;
}
export function otpauthURL({ secret, account, issuer = "Sushen Macro Tracking" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---- PBKDF2 password hashing ----
const PBKDF2_ITER = 210000;
export async function hashPassword(password, saltBytes) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `pbkdf2$${PBKDF2_ITER}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}
export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltHex, hashHex] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const salt = hexToBytes(saltHex);
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: Number(iterStr), hash: "SHA-256" },
      keyMaterial,
      256
    );
    const got = bytesToHex(new Uint8Array(bits));
    // constant-time-ish compare
    if (got.length !== hashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashHex.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// ---- HS256 JWT ----
async function hmacSha256(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export async function signJWT(payload, secret, { expiresInSec = 60 * 60 * 24 * 30 } = {}) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const h = bytesToB64url(enc.encode(JSON.stringify(header)));
  const p = bytesToB64url(enc.encode(JSON.stringify(body)));
  const sig = bytesToB64url(await hmacSha256(secret, `${h}.${p}`));
  return `${h}.${p}.${sig}`;
}
export async function verifyJWT(token, secret) {
  try {
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return null;
    const expected = bytesToB64url(await hmacSha256(secret, `${h}.${p}`));
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
