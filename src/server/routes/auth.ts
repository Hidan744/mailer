import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/auth";

const router = Router();

// Простая защита от подбора пароля: после 5 неудачных попыток с одного IP — блокировка
// на 15 минут. Хранится в памяти процесса — этого достаточно для одного сервера
// (при рестарте контейнера счётчики сбрасываются, это не проблема).
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();

function isLockedOut(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (entry.blockedUntil && entry.blockedUntil > Date.now()) return true;
  if (entry.blockedUntil && entry.blockedUntil <= Date.now()) failedAttempts.delete(ip);
  return false;
}

function registerFailedAttempt(ip: string): void {
  const entry = failedAttempts.get(ip) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.blockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  failedAttempts.set(ip, entry);
}

router.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("login", { error: null, next: String(req.query.next || "/"), layout: false });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const nextUrl = typeof req.body.next === "string" && req.body.next.startsWith("/") ? req.body.next : "/";
  const ip = req.ip ?? "unknown";

  if (isLockedOut(ip)) {
    return res
      .status(429)
      .render("login", { error: "Слишком много неудачных попыток входа. Попробуйте снова через 15 минут.", next: nextUrl, layout: false });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    registerFailedAttempt(ip);
    return res.status(401).render("login", { error: "Неверный логин или пароль", next: nextUrl, layout: false });
  }
  failedAttempts.delete(ip);

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect(nextUrl);
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

export default router;
