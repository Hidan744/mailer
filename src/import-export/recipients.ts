import ExcelJS from "exceljs";

// Ожидаемые колонки в Excel-файле получателей (шапка в первой строке, порядок не важен,
// колонки ищутся по названию без учёта регистра):
//   Компания | Должность | Фамилия И.О. | Имя Отчество | Email
const COLUMN_ALIASES: Record<string, string[]> = {
  company: ["компания", "организация"],
  position: ["должность"],
  surnameInitials: ["фамилия и.о.", "фамилия и о", "фио для шапки", "фамилия"],
  fullNamePatronymic: ["имя отчество", "имя отчество для обращения", "имя и отчество"],
  email: ["email", "e-mail", "почта", "электронная почта"],
};

export interface ParsedRecipient {
  company: string;
  position: string;
  surnameInitials: string;
  fullNamePatronymic: string;
  email: string;
  extra: Record<string, unknown>;
}

export interface ParseResult {
  recipients: ParsedRecipient[];
  errors: string[];
  warnings: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Excel/ExcelJS отдаёт значение ячейки не всегда простой строкой: гиперссылка (например,
// когда Excel сам подчеркнул email как mailto:) приходит объектом { text, hyperlink },
// форматированный текст — { richText: [...] }, формула — { formula, result }. Достаём
// реальный текст в каждом из этих случаев, а не просто String(val).
function cellText(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    const v = val as { text?: unknown; richText?: Array<{ text?: unknown }>; result?: unknown };
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) return v.richText.map((r) => String(r.text ?? "")).join("").trim();
    if (v.result !== undefined && v.result !== null) return String(v.result).trim();
  }
  return String(val).trim();
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function matchColumn(headers: string[]): Partial<Record<keyof typeof COLUMN_ALIASES, number>> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(norm) && map[field] === undefined) {
        map[field] = idx;
      }
    }
  });
  return map;
}

export async function parseRecipientsXlsx(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { recipients: [], errors: ["В файле нет листов"], warnings: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  const colMap = matchColumn(headers);
  const errors: string[] = [];
  const required: (keyof typeof COLUMN_ALIASES)[] = [
    "company",
    "position",
    "surnameInitials",
    "fullNamePatronymic",
    "email",
  ];
  for (const field of required) {
    if (colMap[field] === undefined) {
      errors.push(`Не найдена колонка для поля "${field}" — проверьте заголовки файла`);
    }
  }
  if (errors.length > 0) return { recipients: [], errors, warnings: [] };

  const recipients: ParsedRecipient[] = [];
  const seenEmails = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const getCell = (field: keyof typeof COLUMN_ALIASES) => {
      const idx = colMap[field];
      if (idx === undefined) return "";
      return cellText(row.getCell(idx + 1).value);
    };

    const email = getCell("email");
    if (!email) return; // пропускаем пустые строки

    if (!EMAIL_RE.test(email)) {
      invalidCount++;
      return; // пропускаем явно некорректный email
    }
    const emailKey = email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      duplicateCount++;
      return; // такой email уже встречался в этом файле — пропускаем повтор
    }
    seenEmails.add(emailKey);

    const extra: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const norm = normalizeHeader(h);
      const isKnown = Object.values(colMap).includes(idx);
      if (!isKnown && h) {
        extra[h] = row.getCell(idx + 1).value;
      }
    });

    recipients.push({
      company: getCell("company"),
      position: getCell("position"),
      surnameInitials: getCell("surnameInitials"),
      fullNamePatronymic: getCell("fullNamePatronymic"),
      email,
      extra,
    });
  });

  const warnings: string[] = [];
  if (invalidCount > 0) warnings.push(`Пропущено строк с некорректным email: ${invalidCount}`);
  if (duplicateCount > 0) warnings.push(`Пропущено повторяющихся email внутри файла: ${duplicateCount}`);

  return { recipients, errors: [], warnings };
}
