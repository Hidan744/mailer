import { Router } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

router.get("/", async (req, res) => {
  const events = await prisma.auditEvent.findMany({
    where: { organizationId: req.session.organizationId },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  res.render("audit/index", { events });
});

export default router;
