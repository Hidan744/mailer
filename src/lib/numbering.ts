import { prisma } from "./prisma";

// Формат исходящего номера настраивается заказчиком (шаблон типа "{prefix}/{counter}").
// В образце из ТЗ — "Исх. № 0210/186" — не расшифровано, что означает "0210" (постоянный
// код подразделения или тоже счётчик), поэтому это настраиваемый шаблон, а не хардкод:
// значение "prefix" и стартовый "counter" задаются в Настройках → Нумерация при внедрении.

export function renderNumberTemplate(template: string, prefix: string, counter: number): string {
  return template.replace("{prefix}", prefix).replace("{counter}", String(counter));
}

export async function allocateNextNumber(numberingId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const cfg = await tx.numberingConfig.findUniqueOrThrow({ where: { id: numberingId } });

    let counter = cfg.counter;
    const currentYear = new Date().getFullYear();
    if (cfg.resetPeriod === "yearly" && cfg.lastResetYear !== currentYear) {
      counter = 1;
    }

    const formatted = renderNumberTemplate(cfg.template, cfg.prefix, counter);

    await tx.numberingConfig.update({
      where: { id: numberingId },
      data: {
        counter: counter + 1,
        lastResetYear: currentYear,
      },
    });

    return formatted;
  });
}
