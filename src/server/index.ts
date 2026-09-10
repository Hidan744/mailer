import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import dashboardRouter from "./routes/dashboard";
import campaignsRouter from "./routes/campaigns";
import settingsRouter from "./routes/settings";
import trackingRouter from "./routes/tracking";
import authRouter from "./routes/auth";
import { requireAuth, bootstrapAdminUser } from "../lib/auth";
import { startScheduler } from "../scheduler";

const app = express();

// За приложением стоит Caddy, который проксирует по обычному HTTP внутри Docker-сети
// (сам TLS снимает Caddy). Без этого express-session не увидит соединение как secure
// (X-Forwarded-Proto) и молча не поставит cookie сессии при cookie.secure=true —
// вход технически проходит, но браузер остаётся без сессии и его возвращает на /login.
app.set("trust proxy", 1);

app.set("views", path.join(__dirname, "..", "templates", "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "..", "public")));
app.use(
  "/vendor/bootstrap",
  express.static(path.join(__dirname, "..", "..", "node_modules", "bootstrap", "dist"))
);

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET не задан в .env — сгенерируйте случайную строку и задайте её");
}

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.currentUsername = req.session.username ?? null;
  next();
});

// Логин и публичные ссылки из писем (пиксель, отписка) — без авторизации.
app.use("/", authRouter);
app.use(requireAuth);

app.use("/", dashboardRouter);
app.use("/campaigns", campaignsRouter);
app.use("/settings", settingsRouter);
// без префикса: короткие публичные ссылки для трекинг-пикселя и отписки в письмах
app.use("/", trackingRouter);

app.use((req, res) => {
  res.status(404).render("404");
});

const port = Number(process.env.APP_PORT ?? 3000);
app.listen(port, () => {
  console.log(`mailer запущен на порту ${port}`);
  bootstrapAdminUser().catch((err) => console.error("Ошибка создания администратора:", err));
  startScheduler();
});
