import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./prisma";
import { hashPassword } from "./auth";

// Служебный скрипт для сервера (не используется клиентами напрямую — они заводят
// операторов через Настройки, а новых клиентов создаёт суперадмин через /admin).
// Использование: npm run create-user -- <логин> <пароль> [название организации]
// Если организация не указана и существует ровно одна — пользователь добавляется в неё
// как владелец. Если организаций ещё нет — создаётся новая с этим названием (или "Первый клиент").
async function main() {
  const [username, password, orgNameArg] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Использование: npm run create-user -- <логин> <пароль> [название организации]");
    process.exit(1);
  }

  let organizationId: string;
  if (orgNameArg) {
    const found = await prisma.organization.findFirst({ where: { name: orgNameArg } });
    const org = found ?? (await prisma.organization.create({ data: { name: orgNameArg } }));
    organizationId = org.id;
  } else {
    const count = await prisma.organization.count();
    if (count === 0) {
      const org = await prisma.organization.create({ data: { name: "Первый клиент" } });
      organizationId = org.id;
    } else if (count === 1) {
      const org = await prisma.organization.findFirstOrThrow();
      organizationId = org.id;
    } else {
      console.error("Организаций несколько — укажите третьим аргументом название нужной.");
      process.exit(1);
    }
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash, organizationId, role: "owner" },
  });

  console.log(`Пользователь "${username}" создан/обновлён (организация: ${organizationId}).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
