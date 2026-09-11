import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/auth";
import { logAudit } from "../../lib/audit";

const router = Router();

// Панель суперадмина платформы (не клиента) — создание новых организаций-клиентов
// и их первого пользователя-владельца. Публичной регистрации нет намеренно.
router.get("/", async (req, res) => {
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { users: true, campaigns: true } } },
  });
  res.render("admin/index", { organizations, error: req.query.error || null });
});

router.post("/organizations", async (req, res) => {
  const b = req.body;
  const orgName = (b.orgName || "").trim();
  const username = (b.username || "").trim();
  const password = (b.password || "").trim();

  if (!orgName || !username || !password) {
    return res.redirect(`/admin?error=${encodeURIComponent("Заполните название организации, логин и пароль")}`);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.redirect(`/admin?error=${encodeURIComponent("Такой логин уже занят")}`);
  }

  const org = await prisma.organization.create({ data: { name: orgName } });
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      organizationId: org.id,
      role: "owner",
    },
  });
  await logAudit(req.session.username ?? "unknown", "admin.organization_create", { orgId: org.id, orgName, ownerUsername: user.username });
  res.redirect("/admin");
});

export default router;
