import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { encryptSecret } from "../../lib/crypto";
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
  const [mailAccounts, letterheads, numberings] = await Promise.all([
    prisma.mailAccountConfig.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.letterheadTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.numberingConfig.findMany(),
  ]);
  res.render("settings/index", { mailAccounts, letterheads, numberings });
});

// --- Почтовый ящик (SMTP/IMAP) ---

router.post("/mail-accounts", async (req, res) => {
  const b = req.body;
  await prisma.mailAccountConfig.create({
    data: {
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
    },
  });
  res.redirect("/settings");
});

router.post("/mail-accounts/:id/delete", async (req, res) => {
  await prisma.mailAccountConfig.delete({ where: { id: req.params.id } });
  res.redirect("/settings");
});

// --- Фирменный бланк (колонтитулы) ---

router.post(
  "/letterheads",
  upload.fields([{ name: "headerImage", maxCount: 1 }, { name: "footerImage", maxCount: 1 }]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const headerFile = files?.headerImage?.[0];
    const footerFile = files?.footerImage?.[0];
    await prisma.letterheadTemplate.create({
      data: {
        name: req.body.name,
        headerImageUrl: headerFile ? `/uploads/${headerFile.filename}` : null,
        footerImageUrl: footerFile ? `/uploads/${footerFile.filename}` : null,
        footerContactsText: req.body.footerContactsText || null,
      },
    });
    res.redirect("/settings");
  }
);

router.post("/letterheads/:id/delete", async (req, res) => {
  await prisma.letterheadTemplate.delete({ where: { id: req.params.id } });
  res.redirect("/settings");
});

// --- Нумерация исходящих писем ---

router.post("/numbering", async (req, res) => {
  const b = req.body;
  await prisma.numberingConfig.create({
    data: {
      name: b.name,
      template: b.template || "{prefix}/{counter}",
      prefix: b.prefix || "",
      counter: Number(b.counter) || 1,
      resetPeriod: b.resetPeriod === "yearly" ? "yearly" : "never",
    },
  });
  res.redirect("/settings");
});

router.post("/numbering/:id/delete", async (req, res) => {
  await prisma.numberingConfig.delete({ where: { id: req.params.id } });
  res.redirect("/settings");
});

export default router;
