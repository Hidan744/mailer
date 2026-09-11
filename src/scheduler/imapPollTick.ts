import { ImapFlow } from "imapflow";
import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/crypto";
import type { MailAccountConfig } from "@prisma/client";

const LOOKBACK_DAYS = 14;

// Сопоставление ответов: письмо считается ответом, если в его заголовках In-Reply-To/References
// встречается Message-ID письма, которое мы отправили (и на которое ещё не зафиксирован ответ).
export async function runImapPollTick(now: Date = new Date()): Promise<void> {
  const accounts = await prisma.mailAccountConfig.findMany({ where: { imapHost: { not: null } } });

  for (const account of accounts) {
    try {
      const { checked, matched } = await pollAccount(account, now);
      console.log(
        `IMAP-поллинг (${account.name}): писем в ожидании ответа — ${checked}, писем в INBOX просмотрено, новых ответов сопоставлено — ${matched}`
      );
    } catch (err) {
      console.error(`Ошибка опроса IMAP для ящика ${account.name}:`, err);
    }
  }
}

async function pollAccount(account: MailAccountConfig, now: Date): Promise<{ checked: number; matched: number }> {
  const pendingLetters = await prisma.letter.findMany({
    where: {
      status: "sent",
      repliedAt: null,
      messageId: { not: null },
      campaign: { mailAccountId: account.id },
    },
    select: { id: true, messageId: true },
  });
  if (pendingLetters.length === 0) return { checked: 0, matched: 0 };

  const pendingByMessageId = new Map(pendingLetters.map((l) => [l.messageId as string, l.id]));
  let matched = 0;

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
        { envelope: true, headers: ["in-reply-to", "references"] }
      )) {
        const headerBuf = (message as any).headers as Buffer | undefined;
        const headerText = headerBuf ? headerBuf.toString("utf8") : "";
        for (const [messageId, letterId] of pendingByMessageId) {
          if (headerText.includes(messageId)) {
            await prisma.letter.update({ where: { id: letterId }, data: { repliedAt: now } });
            pendingByMessageId.delete(messageId);
            matched++;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return { checked: pendingLetters.length, matched };
}
