import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { encryptSecret } from "../../lib/crypto";
import { hashPassword } from "../../lib/auth";
import { logAudit } from "../../lib/audit";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "..", "..", "..", "public", "uploads"),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/jpg") cb(null, true);
    else cb(new Error("Разрешены только jpg-файлы"));
  },
});

router.get("/", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const [mailAccounts, letterheads, numberings, suppressions, users] = await Promise.all([
    prisma.mailAccountConfig.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.letterheadTemplate.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.numberingConfig.findMany({ where: { organizationId } }),
    prisma.suppression.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
  ]);
  res.render("settings/index", { mailAccounts, letterheads, numberings, suppressions, users });
});

// --- Почтовый ящик (SMTP/IMAP) ---

router.post("/mail-accounts", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const b = req.body;
  const account = await prisma.mailAccountConfig.create({
    data: {
      organizationId,
      name: b.name,
      fromEmail: b.fromEmail,
      fromName: b.fromName || null,
      smtpHost: b.smtpHost,
      smtpPort: Number(b.smtpPort) || 465,
      smtpSecure: b.smtpSecure === "on",
      smtpUser: b.smtpUser,
      smtpPasswordEnc: encryptSecret(b.smtpPassword),
      imapHost: b.imapHost || null,
      imapPort: b.imapPort ? Number(b.imapPort) : 993,
      imapSecure: b.imapSecure === "on",
      imapUser: b.imapUser || null,
      imapPasswordEnc: b.imapPassword ? encryptSecret(b.imapPassword) : null,
      dailyLimit: b.dailyLimit ? Number(b.dailyLimit) : null,
    },
  });
  await logAudit(req.session.username ?? "unknown", "mail_account.create", { id: account.id, name: account.name }, organizationId);
  res.redirect("/settings");
});

router.post("/mail-accounts/:id/update", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const b = req.body;
  const { count } = await prisma.mailAccountConfig.updateMany({
    where: { id: req.params.id, organizationId },
    data: {
      name: b.name,
      fromEmail: b.fromEmail,
      fromName: b.fromName || null,
      smtpHost: b.smtpHost,
      smtpPort: Number(b.smtpPort) || 465,
      smtpSecure: b.smtpSecure === "on",
      smtpUser: b.smtpUser,
      // Пароль меняем только если ввели новый — пустое поле оставляет прежний зашифрованный пароль.
      ...(b.smtpPassword ? { smtpPasswordEnc: encryptSecret(b.smtpPassword) } : {}),
      imapHost: b.imapHost || null,
      imapPort: b.imapPort ? Number(b.imapPort) : 993,
      imapSecure: b.imapSecure === "on",
      imapUser: b.imapUser || null,
      ...(b.imapPassword ? { imapPasswordEnc: encryptSecret(b.imapPassword) } : {}),
      dailyLimit: b.dailyLimit ? Number(b.dailyLimit) : null,
    },
  });
  if (count === 0) return res.status(404).render("404");
  await logAudit(req.session.username ?? "unknown", "mail_account.update", { id: req.params.id, name: b.name }, organizationId);
  res.redirect("/settings");
});

router.post("/mail-accounts/:id/delete", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const account = await prisma.mailAccountConfig.findFirst({ where: { id: req.params.id, organizationId } });
  if (!account) return res.status(404).render("404");
  const inUse = await prisma.campaign.findMany({ where: { mailAccountId: req.params.id }, select: { name: true } });
  if (inUse.length > 0) {
    const names = inUse.map((c) => c.name).join(", ");
    return res.redirect(`/settings?error=${encodeURIComponent(`Нельзя удалить — используется в кампании(ях): ${names}. Сначала выберите другой ящик в этих кампаниях (кнопка "Изменить").`)}`);
  }
  await prisma.mailAccountConfig.delete({ where: { id: req.params.id } });
  await logAudit(req.session.username ?? "unknown", "mail_account.delete", { id: req.params.id }, organizationId);
  res.redirect("/settings");
});

// --- Фирменный бланк (колонтитулы) ---

router.post(
  "/letterheads",
  upload.fields([{ name: "headerImage", maxCount: 1 }, { name: "footerImage", maxCount: 1 }]),
  async (req, res) => {
    const organizationId = req.session.organizationId!;
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const headerFile = files?.headerImage?.[0];
    const footerFile = files?.footerImage?.[0];
    const letterhead = await prisma.letterheadTemplate.create({
      data: {
        organizationId,
        name: req.body.name,
        headerImageUrl: headerFile ? `/uploads/${headerFile.filename}` : null,
        footerImageUrl: footerFile ? `/uploads/${footerFile.filename}` : null,
        footerContactsText: req.body.footerContactsText || null,
      },
    });
    await logAudit(req.session.username ?? "unknown", "letterhead.create", { id: letterhead.id, name: letterhead.name }, organizationId);
    res.redirect("/settings");
  }
);

router.post("/letterheads/:id/delete", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const letterhead = await prisma.letterheadTemplate.findFirst({ where: { id: req.params.id, organizationId } });
  if (!letterhead) return res.status(404).render("404");
  const inUse = await prisma.campaign.findMany({ where: { letterheadId: req.params.id }, select: { name: true } });
  if (inUse.length > 0) {
    const names = inUse.map((c) => c.name).join(", ");
    return res.redirect(`/settings?error=${encodeURIComponent(`Нельзя удалить — используется в кампании(ях): ${names}. Сначала выберите другой бланк в этих кампаниях (кнопка "Изменить").`)}`);
  }
  await prisma.letterheadTemplate.delete({ where: { id: req.params.id } });
  await logAudit(req.session.username ?? "unknown", "letterhead.delete", { id: req.params.id }, organizationId);
  res.redirect("/settings");
});

// --- Нумерация исходящих писем ---

router.post("/numbering", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const b = req.body;
  const numbering = await prisma.numberingConfig.create({
    data: {
      organizationId,
      name: b.name,
      template: b.template || "{prefix}/{counter}",
      prefix: b.prefix || "",
      counter: Number(b.counter) || 1,
      resetPeriod: b.resetPeriod === "yearly" ? "yearly" : "never",
    },
  });
  await logAudit(req.session.username ?? "unknown", "numbering.create", { id: numbering.id, name: numbering.name }, organizationId);
  res.redirect("/settings");
});

router.post("/numbering/:id/update", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const b = req.body;
  const { count } = await prisma.numberingConfig.updateMany({
    where: { id: req.params.id, organizationId },
    data: {
      name: b.name,
      template: b.template || "{prefix}/{counter}",
      prefix: b.prefix || "",
      counter: Number(b.counter) || 1,
      resetPeriod: b.resetPeriod === "yearly" ? "yearly" : "never",
    },
  });
  if (count === 0) return res.status(404).render("404");
  await logAudit(req.session.username ?? "unknown", "numbering.update", { id: req.params.id, name: b.name }, organizationId);
  res.redirect("/settings");
});

router.post("/numbering/:id/delete", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const numbering = await prisma.numberingConfig.findFirst({ where: { id: req.params.id, organizationId } });
  if (!numbering) return res.status(404).render("404");
  const inUse = await prisma.campaign.findMany({ where: { numberingId: req.params.id }, select: { name: true } });
  if (inUse.length > 0) {
    const names = inUse.map((c) => c.name).join(", ");
    return res.redirect(`/settings?error=${encodeURIComponent(`Нельзя удалить — используется в кампании(ях): ${names}. Сначала выберите другую схему в этих кампаниях (кнопка "Изменить").`)}`);
  }
  await prisma.numberingConfig.delete({ where: { id: req.params.id } });
  await logAudit(req.session.username ?? "unknown", "numbering.delete", { id: req.params.id }, organizationId);
  res.redirect("/settings");
});

// --- Отписавшиеся (список подавления рассылки в рамках организации) ---

router.post("/suppressions/:id/delete", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const suppression = await prisma.suppression.findFirst({ where: { id: req.params.id, organizationId } });
  if (!suppression) return res.status(404).render("404");
  await prisma.suppression.delete({ where: { id: req.params.id } });
  await logAudit(req.session.username ?? "unknown", "suppression.remove", { email: suppression.email }, organizationId);
  res.redirect("/settings");
});

// --- Пользователи организации (владелец добавляет/удаляет операторов) ---

router.post("/users", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const b = req.body;
  const username = (b.username || "").trim();
  const password = (b.password || "").trim();
  const role = b.role === "owner" ? "owner" : "operator";
  if (!username || !password) {
    return res.redirect(`/settings?error=${encodeURIComponent("Укажите логин и пароль")}`);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.redirect(`/settings?error=${encodeURIComponent("Такой логин уже занят")}`);
  }

  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password), organizationId, role },
  });
  await logAudit(req.session.username ?? "unknown", "user.create", { id: user.id, username: user.username, role }, organizationId);
  res.redirect("/settings");
});

router.post("/users/:id/delete", async (req, res) => {
  const organizationId = req.session.organizationId!;
  const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
  if (!user) return res.status(404).render("404");
  if (user.id === req.session.userId) {
    return res.redirect(`/settings?error=${encodeURIComponent("Нельзя удалить самого себя")}`);
  }
  const ownersLeft = await prisma.user.count({ where: { organizationId, role: "owner" } });
  if (user.role === "owner" && ownersLeft <= 1) {
    return res.redirect(`/settings?error=${encodeURIComponent("Нельзя удалить последнего владельца организации")}`);
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  await logAudit(req.session.username ?? "unknown", "user.delete", { id: req.params.id, username: user.username }, organizationId);
  res.redirect("/settings");
});

export default router;
