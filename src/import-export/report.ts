import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";

export async function buildCampaignReportXlsx(campaignId: string): Promise<ExcelJS.Buffer> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const letters = await prisma.letter.findMany({
    where: { campaignId },
    include: { recipient: true },
    orderBy: { queuedAt: "asc" },
  });
  const suppressedEmails = new Set(
    (await prisma.suppression.findMany({ select: { email: true } })).map((s) => s.email.toLowerCase())
  );

  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet("Сводка");
  const sent = letters.filter((l) => l.status === "sent").length;
  const opened = letters.filter((l) => l.openedAt).length;
  const replied = letters.filter((l) => l.repliedAt).length;
  const failed = letters.filter((l) => l.status === "failed").length;
  const bounced = letters.filter((l) => l.bouncedAt).length;
  const unsubscribed = letters.filter((l) => suppressedEmails.has(l.recipient.email.toLowerCase())).length;
  summary.addRows([
    ["Кампания", campaign.name],
    ["Всего получателей", letters.length],
    ["Отправлено", sent],
    ["Ошибок отправки", failed],
    ["Не доставлено (отказ сервера)", bounced],
    ["Открыто", opened],
    ["Получено ответов", replied],
    ["Отписалось", unsubscribed],
  ]);
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 40;

  const details = workbook.addWorksheet("Детализация");
  details.addRow([
    "Исх. №",
    "Компания",
    "Должность",
    "Получатель",
    "Email",
    "Статус",
    "Дата отправки",
    "Не доставлено",
    "Открыто",
    "Дата открытия",
    "Получен ответ",
    "Дата ответа",
    "Отписался",
  ]);
  details.getRow(1).font = { bold: true };

  for (const l of letters) {
    details.addRow([
      l.outgoingNumber ?? "",
      l.recipient.company,
      l.recipient.position,
      l.recipient.surnameInitials,
      l.recipient.email,
      l.status,
      l.sentAt ? l.sentAt.toLocaleString("ru-RU") : "",
      l.bouncedAt ? "да" : "нет",
      l.openedAt ? "да" : "нет",
      l.openedAt ? l.openedAt.toLocaleString("ru-RU") : "",
      l.repliedAt ? "да" : "нет",
      l.repliedAt ? l.repliedAt.toLocaleString("ru-RU") : "",
      suppressedEmails.has(l.recipient.email.toLowerCase()) ? "да" : "нет",
    ]);
  }
  details.columns.forEach((c) => (c.width = 20));

  return workbook.xlsx.writeBuffer();
}
