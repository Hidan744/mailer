import cron from "node-cron";
import { runSendTick } from "./sendTick";
import { runImapPollTick } from "./imapPollTick";

export function startScheduler(): void {
  // Раз в минуту: проверяем рабочее окно/обед/интервал 5 мин для каждой активной кампании
  // и, если пора, отправляем следующее письмо (см. src/scheduler/sendTick.ts).
  cron.schedule("* * * * *", () => {
    runSendTick().catch((err) => console.error("Ошибка тика отправки:", err));
  });

  // Раз в 5 минут: проверяем входящие на предмет ответов на отправленные письма.
  cron.schedule("*/5 * * * *", () => {
    runImapPollTick().catch((err) => console.error("Ошибка опроса IMAP:", err));
  });

  console.log("Планировщик запущен: отправка каждую минуту (по окну), IMAP-поллинг каждые 5 минут");
}
