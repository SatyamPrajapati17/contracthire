import { randomBytes, createHash } from "node:crypto";

// ─── ID prefixes (doc 06) ────────────────────────────────────────────────
const PREFIXES = {
  ws: "ws", usr: "usr", mem: "mem", tok: "tok", ses: "ses",
  ct: "ct", dv: "dv", pp: "pp", cl: "cl", chk: "chk", cit: "cit",
  ef: "ef", fc: "fc", ob: "ob", oe: "oe", as: "as", ad: "ad",
  rf: "rf", rd: "rd", pbr: "pbr", cmp: "cmp", chg: "chg",
  cses: "cses", msg: "msg", ps: "ps", ai: "ai", nt: "nt", req: "req"
} as const;
export type IdKind = keyof typeof PREFIXES;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Crockford-ish base32 random string. */
function randomBase32(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** ULID-like prefixed id, e.g. ct_m93x2k4f0abcde... */
export function id(kind: IdKind): string {
  const time = Date.now().toString(32).padStart(9, "0");
  return `${PREFIXES[kind]}_${time}${randomBase32(12)}`;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
