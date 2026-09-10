// Логика "рабочего окна" отправки: будни 9:00-17:00 по Перми (Asia/Yekaterinburg),
// обеденный перерыв 12:00-13:00. Значения настраиваются per-кампания (Campaign),
// но приходят с этими дефолтами.

export interface SendWindowConfig {
  sendWindowStart: string; // "09:00"
  sendWindowEnd: string; // "17:00"
  lunchStart: string; // "12:00"
  lunchEnd: string; // "13:00"
  timezone: string; // "Asia/Yekaterinburg"
}

interface ZonedTime {
  minutesSinceMidnight: number;
  weekday: number; // 0=Sun..6=Sat
}

function getZonedTime(date: Date, timeZone: string): ZonedTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[get("weekday")] ?? -1;
  return { minutesSinceMidnight: hour * 60 + minute, weekday };
}

function toMinutes(hhmm: string): number {
  const parts = hhmm.split(":").map((p) => parseInt(p, 10));
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return h * 60 + m;
}

export function isWithinSendingWindow(now: Date, cfg: SendWindowConfig): boolean {
  const zoned = getZonedTime(now, cfg.timezone);
  if (zoned.weekday === 0 || zoned.weekday === 6) return false; // выходные

  const start = toMinutes(cfg.sendWindowStart);
  const end = toMinutes(cfg.sendWindowEnd);
  const lunchStart = toMinutes(cfg.lunchStart);
  const lunchEnd = toMinutes(cfg.lunchEnd);
  const t = zoned.minutesSinceMidnight;

  const inWorkHours = t >= start && t < end;
  const inLunch = t >= lunchStart && t < lunchEnd;
  return inWorkHours && !inLunch;
}
