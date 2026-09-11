import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    username?: string;
    organizationId?: string;
    organizationName?: string;
    role?: "owner" | "operator";
    isSuperAdmin?: boolean;
  }
}

// Пускает без логина только страницу входа и публичные ссылки из писем
// (трекинг-пиксель и отписка — по ним переходят получатели, не операторы).
const PUBLIC_PATHS = [/^\/login$/, /^\/t\/[^/]+\.gif$/, /^\/unsubscribe\//];

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
  if (req.session.userId) {
    res.locals.currentUsername = req.session.username;
    res.locals.currentOrganizationName = req.session.organizationName;
    res.locals.currentRole = req.session.role;
    res.locals.isSuperAdmin = req.session.isSuperAdmin;
    return next();
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Владелец организации — доступ к настройкам (ящики/бланки/нумерация/пользователи).
// Оператору доступны только кампании.
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.session.role === "owner") return next();
  res.status(403).render("404");
}

// Суперадмин платформы (не клиент) — создаёт новые организации через /admin.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session.isSuperAdmin) return next();
  res.status(403).render("404");
}

// Первый запуск: если пользователей ещё нет, а в окружении заданы ADMIN_USERNAME/
// ADMIN_PASSWORD — создаём организацию и администратора автоматически, чтобы было
// куда войти (и он же становится суперадмином, чтобы дальше заводить новых клиентов).
export async function bootstrapAdminUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      "Пользователей нет, а ADMIN_USERNAME/ADMIN_PASSWORD не заданы в .env — " +
        "войти в приложение будет некому. Задайте их и перезапустите, " +
        "либо создайте пользователя: npm run create-user -- <логин> <пароль>"
    );
    return;
  }

  const org = await prisma.organization.create({ data: { name: "Первый клиент" } });
  await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      organizationId: org.id,
      role: "owner",
      isSuperAdmin: true,
    },
  });
  console.log(`Создана организация "${org.name}" и первый администратор: ${username}`);
}
