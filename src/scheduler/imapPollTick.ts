import { ImapFlow } from "imapflow";
import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/crypto";
import type { MailAccountConfig } from "@prisma/client";

const LOOKBACK_DAYS = 14;

// Признаки письма-отказа (bounce/NDR) от почтового сервера получателя — отправитель
// "mailer-daemon"/"postmaster" или типовая тема об недоставке (рус./англ. варианты).
const BOUNCE_FROM_RE = /mailer-daemon|postmaster|mail delivery|delivery subsystem/i;
const BOUNCE_SUBJECT_RE =
  /undelivered|delivery (has )?failed|delivery status notification|returned to sender|failure notice|не (может|можем) быть достав|недоставлен/i;

function looksLikeBounce(envelope: { from?: Array<{ address?: string; name?: string }>; subject?: string } | undefined): boolean {
  if (!envelope) return false;
  const from = envelope.from?.[0];
  const fromAddr = from?.address ?? "";
  const fromName = from?.name ?? "";
  const subject = envelope.subject ?? "";
  return BOUNCE_FROM_RE.test(fromAddr) || BOUNCE_FROM_RE.test(fromName) || BOUNCE_SUBJECT_RE.test(subject);
}

// Сопоставление ответов: письмо считается ответом, если в его заголовках In-Reply-To/References
// встречается Message-ID письма, которое мы отправили (и на которое ещё не зафиксирован ответ).
// Отказы (bounce) определяются иначе: почтовый сервер получателя обычно не проставляет
// In-Reply-To, а присылает уведомление от mailer-daemon/postmaster, внутри которого (в теле,
// как приложенный оригинал письма) встречается наш Message-ID — поэтому для таких писем
// ищем совпадение уже по полному тексту письма, а не только по заголовкам.
export async function runImapPollTick(now: Date = new Date()): Promise<void> {
  const accounts = await prisma.mailAccountConfig.findMany({ where: { imapHost: { not: null } } });

  for (const account of accounts) {
    try {
      const { checked, matched, bounced } = await pollAccount(account, now);
      console.log(
        `IMAP-поллинг (${account.name}): писем в ожидании ответа — ${checked}, новых ответов сопоставлено — ${matched}, новых отказов (bounce) — ${bounced}`
      );
    } catch (err) {
      console.error(`Ошибка опроса IMAP для ящика ${account.name}:`, err);
    }
  }
}

async function pollAccount(
  account: MailAccountConfig,
  now: Date
): Promise<{ checked: number; matched: number; bounced: number }> {
  const pendingLetters = await prisma.letter.findMany({
    where: {
      status: "sent",
      repliedAt: null,
      bouncedAt: null,
      messageId: { not: null },
      campaign: { mailAccountId: account.id },
    },
    select: { id: true, messageId: true },
  });
  if (pendingLetters.length === 0) return { checked: 0, matched: 0, bounced: 0 };

  const pendingByMessageId = new Map(pendingLetters.map((l) => [l.messageId as string, l.id]));
  let matched = 0;
  let bounced = 0;

  const client = new ImapFlow({
    host: account.imapHost as string,
    port: account.imapPort ?? 993,
    secure: account.imapSecure,
    auth: {
      user: account.imapUser as string,
      pass: decryptSecret(account.imapPasswordEnc as string),
    },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      for await (const message of client.fetch(
        { since },
        { envelope: true, headers: ["in-reply-to", "references"], source: true }
      )) {
        const headerBuf = (message as any).headers as Buffer | undefined;
        const headerText = headerBuf ? headerBuf.toString("utf8") : "";
        const bounceCandidate = looksLikeBounce(message.envelope);
        const sourceText = bounceCandidate && message.source ? message.source.toString("utf8") : "";

        for (const [messageId, letterId] of pendingByMessageId) {
          if (headerText.includes(messageId)) {
            await prisma.letter.update({ where: { id: letterId }, data: { repliedAt: now } });
            pendingByMessageId.delete(messageId);
            matched++;
          } else if (bounceCandidate && sourceText.includes(messageId)) {
            await prisma.letter.update({ where: { id: letterId }, data: { bouncedAt: now } });
            pendingByMessageId.delete(messageId);
            bounced++;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return { checked: pendingLetters.length, matched, bounced };
}
