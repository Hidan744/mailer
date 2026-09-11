import { Router } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { prisma } from "../../lib/prisma";
import { parseRecipientsXlsx } from "../../import-export/recipients";
import { buildCampaignReportXlsx } from "../../import-export/report";
import { renderLetterHtml } from "../../mail/renderLetter";
import { getCurrentVariant } from "../../lib/textVariants";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/new", async (req, res) => {
  const [mailAccounts, letterheads, numberings] = await Promise.all([
    prisma.mailAccountConfig.findMany(),
    prisma.letterheadTemplate.findMany(),
    prisma.numberingConfig.findMany(),
  ]);
  res.render("campaigns/new", { mailAccounts, letterheads, numberings });
});

router.post("/", async (req, res) => {
  const b = req.body;

  // Доп. варианты темы/текста (п.5 ТЗ) — если оператор заполнил хотя бы один,
  // при достижении порога ротации кампания сама переключится на следующий по кругу,
  // без остановки рассылки. Если ни одного доп. варианта нет — работает старый режим
  // (пауза на ручную правку), см. src/scheduler/sendTick.ts.
  const extraVariants = [2, 3, 4, 5]
    .map((i) => ({ subject: (b[`variantSubject${i}`] || "").trim(), bodyHtml: (b[`variantBody${i}`] || "").trim() }))
    .filter((v) => v.subject && v.bodyHtml);
  const textVariants = extraVariants.length > 0 ? [{ subject: b.subject, bodyHtml: b.bodyHtml }, ...extraVariants] : undefined;

  const campaign = await prisma.campaign.create({
    data: {
      name: b.name,
      subject: b.subject,
      bodyHtml: b.bodyHtml,
      textVariants,
      mailAccountId: b.mailAccountId || null,
      letterheadId: b.letterheadId || null,
      numberingId: b.numberingId || null,
      rotationThreshold: Number(b.rotationThreshold) || 75,
      sendWindowStart: b.sendWindowStart || "09:00",
      sendWindowEnd: b.sendWindowEnd || "17:00",
      lunchStart: b.lunchStart || "12:00",
      lunchEnd: b.lunchEnd || "13:00",
      intervalMinutes: Number(b.intervalMinutes) || 5,
      timezone: b.timezone || "Asia/Yekaterinburg",
    },
  });
  res.redirect(`/campaigns/${campaign.id}`);
});

router.get("/:id/edit", async (req, res) => {
  const [campaign, mailAccounts, letterheads, numberings] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: req.params.id } }),
    prisma.mailAccountConfig.findMany(),
    prisma.letterheadTemplate.findMany(),
    prisma.numberingConfig.findMany(),
  ]);
  if (!campaign) return res.status(404).render("404");
  const variants = Array.isArray(campaign.textVariants)
    ? (campaign.textVariants as unknown as { subject: string; bodyHtml: string }[])
    : [];
  res.render("campaigns/edit", { campaign, mailAccounts, letterheads, numberings, extraVariants: variants.slice(1) });
});

router.post("/:id/edit", async (req, res) => {
  const b = req.body;

  const extraVariants = [2, 3, 4, 5]
    .map((i) => ({ subject: (b[`variantSubject${i}`] || "").trim(), bodyHtml: (b[`variantBody${i}`] || "").trim() }))
    .filter((v) => v.subject && v.bodyHtml);
  const textVariants =
    extraVariants.length > 0 ? [{ subject: b.subject, bodyHtml: b.bodyHtml }, ...extraVariants] : Prisma.JsonNull;

  await prisma.campaign.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      subject: b.subject,
      bodyHtml: b.bodyHtml,
      textVariants,
      mailAccountId: b.mailAccountId || null,
      letterheadId: b.letterheadId || null,
      numberingId: b.numberingId || null,
      rotationThreshold: Number(b.rotationThreshold) || 75,
      sendWindowStart: b.sendWindowStart || "09:00",
      sendWindowEnd: b.sendWindowEnd || "17:00",
      lunchStart: b.lunchStart || "12:00",
      lunchEnd: b.lunchEnd || "13:00",
      intervalMinutes: Number(b.intervalMinutes) || 5,
      timezone: b.timezone || "Asia/Yekaterinburg",
    },
  });
  res.redirect(`/campaigns/${req.params.id}`);
});

router.post("/:id/delete", async (req, res) => {
  await prisma.campaign.delete({ where: { id: req.params.id } }).catch(() => {
    // уже удалена/не найдена — не критично
  });
  res.redirect("/");
});

router.get("/:id", async (req, res) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: req.params.id },
    include: { letterhead: true, mailAccount: true, numbering: true },
  });
  if (!campaign) return res.status(404).render("404");

  const [recipientsCount, sent, opened, replied, failed, queued, bounced, recipients, suppressedEmails] =
    await Promise.all([
      prisma.recipient.count({ where: { campaignId: campaign.id } }),
      prisma.letter.count({ where: { campaignId: campaign.id, status: "sent" } }),
      prisma.letter.count({ where: { campaignId: campaign.id, openedAt: { not: null } } }),
      prisma.letter.count({ where: { campaignId: campaign.id, repliedAt: { not: null } } }),
      prisma.letter.count({ where: { campaignId: campaign.id, status: "failed" } }),
      prisma.letter.count({ where: { campaignId: campaign.id, status: "queued" } }),
      prisma.letter.count({ where: { campaignId: campaign.id, bouncedAt: { not: null } } }),
      prisma.recipient.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: "asc" } }),
      prisma.suppression.findMany({ select: { email: true } }),
    ]);

  // Сколько получателей ЭТОЙ кампании отписались (глобально, по email) — отдельно от общего
  // списка отписавшихся в Настройках, тут именно в разрезе конкретной кампании.
  const suppressedSet = new Set(suppressedEmails.map((s) => s.email.toLowerCase()));
  const unsubscribed = recipients.filter((r) => suppressedSet.has(r.email.toLowerCase())).length;

  const sampleRecipient = recipients[0];
  let previewHtml: string | null = null;
  if (sampleRecipient) {
    const currentText = getCurrentVariant(campaign);
    previewHtml = renderLetterHtml({
      campaign: { subject: currentText.subject, bodyHtml: currentText.bodyHtml },
      recipient: sampleRecipient,
      letterhead: campaign.letterhead,
      outgoingNumber:
        sampleRecipient.manualOutgoingNumber || (campaign.numbering ? `${campaign.numbering.prefix}/…` : "…"),
      sentDate: new Date(),
      trackingPixelUrl: "#",
      unsubscribeUrl: "#",
      publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    });
  }

  res.render("campaigns/show", {
    campaign,
    recipients,
    recipientsCount,
    stats: { sent, opened, replied, failed, queued, bounced, unsubscribed },
    previewHtml,
  });
});

router.post("/:id/recipients/import", upload.single("file"), async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).render("404");
  if (!req.file) return res.redirect(`/campaigns/${campaign.id}?error=Файл не выбран`);

  const { recipients, errors, warnings } = await parseRecipientsXlsx(req.file.buffer);
  if (errors.length > 0) {
    return res.redirect(`/campaigns/${campaign.id}?error=${encodeURIComponent(errors.join("; "))}`);
  }

  // Не дублируем получателей, у которых email уже есть в этой кампании (без учёта регистра) —
  // частый случай при повторном импорте обновлённого списка.
  const existing = await prisma.recipient.findMany({ where: { campaignId: campaign.id }, select: { email: true } });
  const existingEmails = new Set(existing.map((r) => r.email.toLowerCase()));
  const newRecipients = recipients.filter((r) => !existingEmails.has(r.email.toLowerCase()));
  const alreadyInCampaign = recipients.length - newRecipients.length;

  if (newRecipients.length > 0) {
    await prisma.recipient.createMany({
      data: newRecipients.map((r) => ({ ...r, campaignId: campaign.id, extra: r.extra as object })),
    });
  }

  const allWarnings = [...warnings];
  if (alreadyInCampaign > 0) allWarnings.push(`Уже были в этой кампании и не добавлены повторно: ${alreadyInCampaign}`);
  const warningParam = allWarnings.length > 0 ? `&warning=${encodeURIComponent(allWarnings.join("; "))}` : "";

  res.redirect(`/campaigns/${campaign.id}?imported=${newRecipients.length}${warningParam}`);
});

// Ручные исходящие номера по получателям (например, у компании уже есть свой номер
// входящего документа) — не трогает автосчётчик схемы нумерации для таких получателей.
router.post("/:id/recipients/numbers", async (req, res) => {
  const b = req.body;
  const recipients = await prisma.recipient.findMany({ where: { campaignId: req.params.id }, select: { id: true } });
  await Promise.all(
    recipients.map((r) => {
      const raw = (b[`number_${r.id}`] ?? "").toString().trim();
      return prisma.recipient.update({
        where: { id: r.id },
        data: { manualOutgoingNumber: raw || null },
      });
    })
  );
  res.redirect(`/campaigns/${req.params.id}`);
});

router.post("/:id/start", async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).render("404");
  if (!campaign.mailAccountId || !campaign.numberingId) {
    return res.redirect(`/campaigns/${campaign.id}?error=Укажите почтовый ящик и схему нумерации перед запуском`);
  }

  // Письма создаём только тем получателям, у которых их ещё нет в этой кампании — так
  // можно не только запустить кампанию первый раз, но и доимпортировать получателей в
  // уже завершённую (status=done) кампанию и продолжить рассылку только для новых.
  const recipientsWithoutLetter = await prisma.recipient.findMany({
    where: { campaignId: campaign.id, letters: { none: {} } },
  });
  if (recipientsWithoutLetter.length > 0) {
    // subjectSnapshot/bodySnapshot заполняются планировщиком в момент фактической отправки —
    // это и есть тот текст, который получатель реально увидит (после возможной правки на
    // чек-пойнте ротации, см. src/scheduler).
    await prisma.letter.createMany({
      data: recipientsWithoutLetter.map((r) => ({
        campaignId: campaign.id,
        recipientId: r.id,
      })),
    });
  }

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "running" } });
  res.redirect(`/campaigns/${campaign.id}`);
});

router.post("/:id/pause", async (req, res) => {
  await prisma.campaign.update({ where: { id: req.params.id }, data: { status: "paused_manual" } });
  res.redirect(`/campaigns/${req.params.id}`);
});

router.post("/:id/resume", async (req, res) => {
  await prisma.campaign.update({ where: { id: req.params.id }, data: { status: "running" } });
  res.redirect(`/campaigns/${req.params.id}`);
});

// Возврат в очередь писем, не ушедших из-за временной ошибки (например недоступность SMTP) —
// без этого единственный способ повторить отправку был вручную править БД.
router.post("/:id/retry-failed", async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).render("404");

  await prisma.letter.updateMany({
    where: { campaignId: campaign.id, status: "failed" },
    data: { status: "queued", errorMessage: null },
  });
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "running" } });
  res.redirect(`/campaigns/${campaign.id}`);
});

// Чек-пойнт ротации текста (п.5 ТЗ): оператор правит тему/текст (или подтверждает как есть)
// и явно продолжает рассылку — счётчик sentSinceLastEdit обнуляется.
router.post("/:id/confirm-edit", async (req, res) => {
  const b = req.body;
  await prisma.campaign.update({
    where: { id: req.params.id },
    data: {
      subject: b.subject,
      bodyHtml: b.bodyHtml,
      sentSinceLastEdit: 0,
      status: "running",
    },
  });
  res.redirect(`/campaigns/${req.params.id}`);
});

router.get("/:id/report.xlsx", async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).render("404");
  const buffer = await buildCampaignReportXlsx(campaign.id);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="report-${campaign.id}.xlsx"`);
  res.send(buffer);
});

export default router;
