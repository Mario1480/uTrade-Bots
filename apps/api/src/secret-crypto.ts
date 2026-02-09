import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function resolveMasterKey(): Buffer {
  const raw = process.env.SECRET_MASTER_KEY?.trim() ?? "";
  if (!raw) {
    throw new Error("SECRET_MASTER_KEY is required");
  }

  // 64-char hex key
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  // 32-byte raw string
  if (raw.length === 32) {
    return Buffer.from(raw, "utf8");
  }

  // base64-encoded 32-byte key
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) {
    return base64;
  }

  throw new Error("SECRET_MASTER_KEY must be 32-byte raw, 64-char hex, or base64(32-byte)");
}

export function encryptSecret(plaintext: string): string {
  const key = resolveMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

export function decryptSecret(ciphertext: string): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret format");
  }

  const key = resolveMasterKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
