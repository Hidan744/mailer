import type { Campaign, LetterheadTemplate, Recipient } from "@prisma/client";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRuDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export interface RenderLetterInput {
  campaign: Pick<Campaign, "subject" | "bodyHtml">;
  recipient: Pick<Recipient, "company" | "position" | "surnameInitials" | "fullNamePatronymic">;
  letterhead: Pick<LetterheadTemplate, "headerImageUrl" | "footerImageUrl" | "footerContactsText"> | null;
  outgoingNumber: string;
  sentDate: Date;
  trackingPixelUrl: string;
  unsubscribeUrl: string;
  publicBaseUrl: string;
}

// Сборка письма-бланка по образцу из ТЗ:
//   Исх. № {номер} от {дата}                Должность
//                                             Компания получателя
//                                             Фамилия И.О.
//
//                Уважаемый Имя Отчество!
//
//   {тело письма}
//
// Верстается таблицами (не flex/grid) — так вёрстка стабильно переживает Outlook/почтовые клиенты.
export function renderLetterHtml(input: RenderLetterInput): string {
  const { campaign, recipient, letterhead, outgoingNumber, sentDate, trackingPixelUrl, unsubscribeUrl } = input;

  const headerImg = letterhead?.headerImageUrl
    ? `<tr><td style="padding:0 0 16px 0;"><img src="${esc(
        toAbsolute(letterhead.headerImageUrl, input.publicBaseUrl)
      )}" alt="" style="max-width:100%;display:block;" /></td></tr>`
    : "";

  const footerImg = letterhead?.footerImageUrl
    ? `<tr><td style="padding:16px 0 0 0;"><img src="${esc(
        toAbsolute(letterhead.footerImageUrl, input.publicBaseUrl)
      )}" alt="" style="max-width:100%;display:block;" /></td></tr>`
    : "";

  const footerContacts = letterhead?.footerContactsText
    ? `<tr><td style="padding-top:8px;font-family:Arial,sans-serif;font-size:12px;color:#555;">${esc(
        letterhead.footerContactsText
      ).replace(/\n/g, "<br/>")}</td></tr>`
    : "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px;font-family:Arial,sans-serif;font-size:14px;color:#111;">
${headerImg}
<tr><td>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" style="width:50%;">Исх.&nbsp;№&nbsp;${esc(outgoingNumber)} от ${esc(formatRuDate(sentDate))}</td>
      <td valign="top" style="width:50%;text-align:right;">
        ${esc(recipient.position)}<br/>
        ${esc(recipient.company)}<br/>
        ${esc(recipient.surnameInitials)}
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:32px 0 16px 0;text-align:center;font-weight:bold;">
  Уважаемый ${esc(recipient.fullNamePatronymic)}!
</td></tr>
<tr><td style="padding-top:8px;line-height:1.5;">
  ${campaign.bodyHtml}
</td></tr>
${footerImg}
${footerContacts}
<tr><td style="padding-top:24px;font-family:Arial,sans-serif;font-size:11px;color:#999;text-align:center;">
  <a href="${esc(unsubscribeUrl)}" style="color:#999;">Отписаться от рассылки</a>
</td></tr>
</table>
</td></tr>
</table>
<img src="${esc(trackingPixelUrl)}" width="1" height="1" alt="" style="display:none;" />
</body>
</html>`;
}

function toAbsolute(pathOrUrl: string, base: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${base.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
