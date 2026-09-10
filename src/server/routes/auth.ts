import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/auth";

const router = Router();

router.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("login", { error: null, next: String(req.query.next || "/"), layout: false });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const nextUrl = typeof req.body.next === "string" && req.body.next.startsWith("/") ? req.body.next : "/";

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return res.status(401).render("login", { error: "Неверный логин или пароль", next: nextUrl, layout: false });
  }

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
