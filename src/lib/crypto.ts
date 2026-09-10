import sodium from "sodium-native";

// Шифрование паролей от почтовых ящиков перед сохранением в БД (не храним plaintext).
// Ключ — 32 байта в hex, из переменной окружения CREDENTIALS_ENC_KEY (см. .env.example).

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
  const message = Buffer.from(plaintext, "utf8");
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
  sodium.randombytes_buf(nonce);
  const ciphertext = Buffer.alloc(message.length + sodium.crypto_secretbox_MACBYTES);
  sodium.crypto_secretbox_easy(ciphertext, message, nonce, key);
  return Buffer.concat([nonce, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const nonce = raw.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = raw.subarray(sodium.crypto_secretbox_NONCEBYTES);
  const message = Buffer.alloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES);
  const ok = sodium.crypto_secretbox_open_easy(message, ciphertext, nonce, key);
  if (!ok) throw new Error("Не удалось расшифровать секрет — неверный ключ или повреждённые данные");
  return message.toString("utf8");
}
