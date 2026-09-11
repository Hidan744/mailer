import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

// Журнал действий операторов — кто и что изменил (создание/удаление кампаний,
// настроек и т.п.). Раньше таблица в схеме была, но никуда не писалась.
export async function logAudit(actor: string, action: string, details?: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: { actor, action, details: details as Prisma.InputJsonValue | undefined },
    });
  } catch (err) {
    console.error("Ошибка записи в журнал действий:", err);
  }
}
