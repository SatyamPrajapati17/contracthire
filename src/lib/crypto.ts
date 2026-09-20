/* AES-256-GCM token encryption for connected accounts (phase 9).
   Key comes from ENCRYPTION_KEY (hex, 32 bytes). Refresh tokens are never
   stored in plaintext; the key never leaves the server. */
import crypto from "node:crypto";

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error("ENCRYPTION_KEY is not set (required for connected accounts)");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptToken(sealed: string): string {
  const [v, ivB64, tagB64, dataB64] = sealed.split(".");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("invalid sealed token format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
