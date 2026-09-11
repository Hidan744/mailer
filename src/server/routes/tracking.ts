import { Router } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

// 1x1 прозрачный gif — используется как трекинг-пиксель открытия письма.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64"
);

router.get("/t/:token.gif", async (req, res) => {
  const { token } = req.params;
  res.set("Content-Type", "image/gif");
  res.set("Cache-Control", "no-store");
  res.send(TRANSPARENT_GIF);

  // Пишем факт открытия асинхронно, ответ пикселем не задерживаем.
  prisma.letter
    .updateMany({
      where: { trackingToken: token, openedAt: null },
      data: { openedAt: new Date() },
    })
    .catch((err) => console.error("Ошибка записи открытия письма:", err));
});

async function suppressByToken(token: string) {
  const letter = await prisma.letter.findUnique({
    where: { trackingToken: token },
    include: { recipient: true, campaign: { select: { organizationId: true } } },
  });
  if (!letter) return null;

  // Список отписавшихся организации (по email) — проверяется планировщиком перед отправкой
  // в ЛЮБОЙ кампании этой же организации, не только в этой.
  await prisma.suppression.upsert({
    where: { organizationId_email: { organizationId: letter.campaign.organizationId, email: letter.recipient.email } },
    update: {},
    create: { organizationId: letter.campaign.organizationId, email: letter.recipient.email, reason: "unsubscribed" },
  });
  if (letter.status === "queued") {
    await prisma.letter.update({
      where: { id: letter.id },
      data: { status: "failed", errorMessage: "unsubscribed" },
    });
  }
  return letter;
}

router.get("/unsubscribe/:token", async (req, res) => {
  const letter = await suppressByToken(req.params.token);
  if (!letter) return res.status(404).render("404");
  res.render("unsubscribed", { email: letter.recipient.email });
});

// One-click отписка (RFC 8058, заголовок List-Unsubscribe-Post) — почтовые клиенты
// (Gmail, Yahoo и т.п.) отписывают пользователя сами POST-запросом сюда, без перехода
// по ссылке и без подтверждающей страницы. Без этого заголовок List-Unsubscribe-Post
// в письме был бы формально заявлен, но не поддержан сервером.
router.post("/unsubscribe/:token", async (req, res) => {
  const letter = await suppressByToken(req.params.token);
  if (!letter) return res.status(404).end();
  res.status(200).end();
});

export default router;
