import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

// Журнал действий операторов — кто и что изменил (создание/удаление кампаний,
// настроек и т.п.). organizationId не задан только для действий вне контекста
// конкретного клиента (например, суперадмин создаёт новую организацию).
export async function logAudit(
  actor: string,
  action: string,
  details?: Record<string, unknown>,
  organizationId?: string
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: { actor, action, details: details as Prisma.InputJsonValue | undefined, organizationId },
    });
  } catch (err) {
    console.error("Ошибка записи в журнал действий:", err);
  }
}
