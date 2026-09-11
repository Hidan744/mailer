import type { Recipient } from "@prisma/client";

type PlaceholderRecipient = Pick<Recipient, "company" | "position" | "surnameInitials" | "fullNamePatronymic" | "email">;

const PLACEHOLDER_FIELDS: Record<string, keyof PlaceholderRecipient> = {
  "Компания": "company",
  "Должность": "position",
  "ФИО": "surnameInitials",
  "Имя": "fullNamePatronymic",
  "Email": "email",
};

export const AVAILABLE_PLACEHOLDERS = Object.keys(PLACEHOLDER_FIELDS);

// Подстановка меток вида {{Компания}} в тексте письма/темы значениями получателя.
// Неизвестные метки оставляются как есть (не ломают письмо, просто не заменяются).
export function applyPlaceholders(text: string, recipient: PlaceholderRecipient): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, name: string) => {
    const field = PLACEHOLDER_FIELDS[name.trim()];
    return field ? recipient[field] : match;
  });
}
