import { Router } from "express";
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

router.get("/:id", async (req, res) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: req.params.id },
    include: { letterhead: true, mailAccount: true, numbering: true },
  });
  if (!campaign) return res.status(404).render("404");

  const [recipientsCount, sent, opened, replied, failed, queued] = await Promise.all([
    prisma.recipient.count({ where: { campaignId: campaign.id } }),
    prisma.letter.count({ where: { campaignId: campaign.id, status: "sent" } }),
    prisma.letter.count({ where: { campaignId: campaign.id, openedAt: { not: null } } }),
    prisma.letter.count({ where: { campaignId: campaign.id, repliedAt: { not: null } } }),
    prisma.letter.count({ where: { campaignId: campaign.id, status: "failed" } }),
    prisma.letter.count({ where: { campaignId: campaign.id, status: "queued" } }),
  ]);

  const sampleRecipient = await prisma.recipient.findFirst({ where: { campaignId: campaign.id } });
  let previewHtml: string | null = null;
  if (sampleRecipient) {
    const currentText = getCurrentVariant(campaign);
    previewHtml = renderLetterHtml({
      campaign: { subject: currentText.subject, bodyHtml: currentText.bodyHtml },
      recipient: sampleRecipient,
      letterhead: campaign.letterhead,
      outgoingNumber: campaign.numbering ? `${campaign.numbering.prefix}/…` : "…",
      sentDate: new Date(),
      trackingPixelUrl: "#",
      unsubscribeUrl: "#",
      publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    });
  }

  res.render("campaigns/show", {
    campaign,
    recipientsCount,
    stats: { sent, opened, replied, failed, queued },
    previewHtml,
  });
});

router.post("/:id/recipients/import", upload.single("file"), async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).render("404");
  if (!req.file) return res.redirect(`/campaigns/${campaign.id}?error=Файл не выбран`);

  const { recipients, errors } = await parseRecipientsXlsx(req.file.buffer);
  if (errors.length > 0) {
    return res.redirect(`/campaigns/${campaign.id}?error=${encodeURIComponent(errors.join("; "))}`);
  }

  await prisma.recipient.createMany({
    data: recipients.map((r) => ({ ...r, campaignId: campaign.id, extra: r.extra as object })),
  });

  res.redirect(`/campaigns/${campaign.id}?imported=${recipients.length}`);
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
