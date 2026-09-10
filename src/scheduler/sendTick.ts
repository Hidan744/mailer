import { prisma } from "../lib/prisma";
import { isWithinSendingWindow } from "../lib/timeWindow";
import { allocateNextNumber } from "../lib/numbering";
import { renderLetterHtml } from "../mail/renderLetter";
import { sendLetter } from "../mail/sendLetter";

const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

// Один тик = один потенциальный отправленный ли для КАЖДОЙ активной кампании независимо.
// Вызывается раз в минуту планировщиком (см. src/scheduler/index.ts).
export async function runSendTick(now: Date = new Date()): Promise<void> {
  const campaigns = await prisma.campaign.findMany({
    where: { status: "running" },
    include: { mailAccount: true, letterhead: true, numbering: true },
  });

  for (const campaign of campaigns) {
    try {
      await processCampaignTick(campaign, now);
    } catch (err) {
      console.error(`Ошибка обработки кампании ${campaign.id}:`, err);
    }
  }
}

async function processCampaignTick(
  campaign: Awaited<ReturnType<typeof prisma.campaign.findMany>>[number] & {
    mailAccount: import("@prisma/client").MailAccountConfig | null;
    letterhead: import("@prisma/client").LetterheadTemplate | null;
    numbering: import("@prisma/client").NumberingConfig | null;
  },
  now: Date
) {
  if (!campaign.mailAccount || !campaign.numbering) return;

  if (
    !isWithinSendingWindow(now, {
      sendWindowStart: campaign.sendWindowStart,
      sendWindowEnd: campaign.sendWindowEnd,
      lunchStart: campaign.lunchStart,
      lunchEnd: campaign.lunchEnd,
      timezone: campaign.timezone,
    })
  ) {
    return; // вне рабочего окна/обед/выходной — ничего не шлём
  }

  const lastSent = await prisma.letter.findFirst({
    where: { campaignId: campaign.id, status: "sent" },
    orderBy: { sentAt: "desc" },
  });
  if (lastSent?.sentAt) {
    const minutesSince = (now.getTime() - lastSent.sentAt.getTime()) / 60000;
    if (minutesSince < campaign.intervalMinutes) return; // ещё не прошло 5 минут
  }

  // Пропускаем получателей, отписавшихся в ЛЮБОЙ кампании
  const suppressed = await prisma.suppression.findMany({ select: { email: true } });
  const suppressedEmails = new Set(suppressed.map((s) => s.email));

  const nextLetter = await prisma.letter.findFirst({
    where: { campaignId: campaign.id, status: "queued" },
    orderBy: { queuedAt: "asc" },
    include: { recipient: true },
  });

  if (!nextLetter) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "done" } });
    return;
  }

  if (suppressedEmails.has(nextLetter.recipient.email)) {
    await prisma.letter.update({
      where: { id: nextLetter.id },
      data: { status: "failed", errorMessage: "в списке отписавшихся" },
    });
    return; // следующий тик возьмёт следующее письмо
  }

  const outgoingNumber = await allocateNextNumber(campaign.numbering.id);
  const trackingUrl = `${publicBaseUrl}/t/${nextLetter.trackingToken}.gif`;
  const unsubscribeUrl = `${publicBaseUrl}/unsubscribe/${nextLetter.trackingToken}`;

  const html = renderLetterHtml({
    campaign,
    recipient: nextLetter.recipient,
    letterhead: campaign.letterhead,
    outgoingNumber,
    sentDate: now,
    trackingPixelUrl: trackingUrl,
    unsubscribeUrl,
    publicBaseUrl,
  });

  try {
    const result = await sendLetter(campaign.mailAccount, {
      to: nextLetter.recipient.email,
      subject: campaign.subject,
      html,
    });

    await prisma.$transaction([
      prisma.letter.update({
        where: { id: nextLetter.id },
        data: {
          status: "sent",
          sentAt: now,
          outgoingNumber,
          sentDate: now.toISOString().slice(0, 10),
          messageId: result.messageId,
          subjectSnapshot: campaign.subject,
          bodySnapshot: campaign.bodyHtml,
        },
      }),
      prisma.campaign.update({
        where: { id: campaign.id },
        data: { sentSinceLastEdit: { increment: 1 } },
      }),
    ]);

    const updated = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    if (updated.sentSinceLastEdit >= updated.rotationThreshold) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "paused_for_edit" } });
    }
  } catch (err) {
    // Номер уже выделен (allocateNextNumber) — фиксируем его и на неудачной попытке,
    // чтобы не терять след в отчёте (гап в нумерации допустим, как и при обычной почте).
    await prisma.letter.update({
      where: { id: nextLetter.id },
      data: { status: "failed", errorMessage: String(err), outgoingNumber, sentDate: now.toISOString().slice(0, 10) },
    });
  }
}
