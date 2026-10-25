// 浏览器安全的随机 ID 生成（替代原 node:crypto 版本）

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function newPollId(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return s;
}

export function newToken(): string {
  return toHex(randomBytes(16));
}

export function newId(): string {
  return toHex(randomBytes(12));
}
