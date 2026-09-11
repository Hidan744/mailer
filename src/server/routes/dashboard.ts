import { Router } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

router.get("/", async (req, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: req.session.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { recipients: true, letters: true } },
    },
  });

  const stats = await Promise.all(
    campaigns.map(async (c) => {
      const [sent, opened, replied] = await Promise.all([
        prisma.letter.count({ where: { campaignId: c.id, status: "sent" } }),
        prisma.letter.count({ where: { campaignId: c.id, openedAt: { not: null } } }),
        prisma.letter.count({ where: { campaignId: c.id, repliedAt: { not: null } } }),
      ]);
      return { id: c.id, sent, opened, replied };
    })
  );
  const statsById = Object.fromEntries(stats.map((s) => [s.id, s]));

  res.render("dashboard", { campaigns, statsById });
});

export default router;
