import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./prisma";
import { hashPassword } from "./auth";

// Использование: npm run create-user -- <логин> <пароль>
async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Использование: npm run create-user -- <логин> <пароль>");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash },
  });

  console.log(`Пользователь "${username}" создан/обновлён.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
