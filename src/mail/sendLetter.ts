import nodemailer from "nodemailer";
import type { MailAccountConfig } from "@prisma/client";
import { decryptSecret } from "../lib/crypto";

export function createTransport(account: MailAccountConfig) {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: {
      user: account.smtpUser,
      pass: decryptSecret(account.smtpPasswordEnc),
    },
  });
}

export interface SendResult {
  messageId: string;
}

export async function sendLetter(
  account: MailAccountConfig,
  opts: { to: string; subject: string; html: string; text: string; unsubscribeUrl: string }
): Promise<SendResult> {
  const transport = createTransport(account);
  const info = await transport.sendMail({
    from: account.fromName ? `"${account.fromName}" <${account.fromEmail}>` : account.fromEmail,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    headers: {
      "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  return { messageId: info.messageId };
}
