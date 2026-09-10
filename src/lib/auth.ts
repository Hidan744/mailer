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
  }
}

// Пускает без логина только страницу входа и публичные ссылки из писем
// (трекинг-пиксель и отписка — по ним переходят получатели, не операторы).
const PUBLIC_PATHS = [/^\/login$/, /^\/t\/[^/]+\.gif$/, /^\/unsubscribe\//];

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
  if (req.session.userId) {
    res.locals.currentUsername = req.session.username;
    return next();
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Первый запуск: если пользователей ещё нет, а в окружении заданы ADMIN_USERNAME/
// ADMIN_PASSWORD — создаём администратора автоматически, чтобы было куда войти.
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

  await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password) },
  });
  console.log(`Создан первый администратор: ${username}`);
}
