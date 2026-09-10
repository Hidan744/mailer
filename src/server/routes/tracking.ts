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

router.get("/unsubscribe/:token", async (req, res) => {
  const letter = await prisma.letter.findUnique({
    where: { trackingToken: req.params.token },
    include: { recipient: true },
  });
  if (!letter) return res.status(404).render("404");

  // Глобальный список отписавшихся (по email) — проверяется планировщиком перед отправкой
  // в ЛЮБОЙ кампании, не только в этой.
  await prisma.suppression.upsert({
    where: { email: letter.recipient.email },
    update: {},
    create: { email: letter.recipient.email, reason: "unsubscribed" },
  });
  if (letter.status === "queued") {
    await prisma.letter.update({
      where: { id: letter.id },
      data: { status: "failed", errorMessage: "unsubscribed" },
    });
  }

  res.render("unsubscribed", { email: letter.recipient.email });
});

export default router;
