import crypto from "node:crypto";

// Шифрование паролей от почтовых ящиков перед сохранением в БД (не храним plaintext).
// AES-256-GCM из встроенного модуля Node — сознательно без нативных addon-библиотек
// (sodium-native не собирается под Alpine/musl, на котором работает Docker-образ).
// Ключ — 32 байта в hex, из переменной окружения CREDENTIALS_ENC_KEY (см. .env.example).

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // рекомендованный размер nonce для GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "CREDENTIALS_ENC_KEY отсутствует или имеет неверную длину (нужно 64 hex-символа / 32 байта). " +
        "Сгенерируйте: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("Не удалось расшифровать секрет — неверный ключ или повреждённые данные");
  }
}
