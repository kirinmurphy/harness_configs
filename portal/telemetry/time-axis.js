const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

const pad = (value) => String(value).padStart(2, "0");

const monthLabel = (date) => date.toLocaleString("en-US", { month: "short" });

export function clockLabel(ts) {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function timeAxisScale(span) {
  if (span < 2 * DAY) return "time";
  if (span < 3 * MONTH) return "day";
  return "month";
}

export function timeAxisLabel(ts, scale, { first = false } = {}) {
  const date = new Date(ts);

  if (scale === "time") return clockLabel(ts);

  if (scale === "day") {
    if (first || date.getDate() === 1) {
      return `${monthLabel(date)} ${date.getDate()}`;
    }

    return String(date.getDate());
  }

  if (first || date.getMonth() === 0) {
    return `${monthLabel(date)} '${String(date.getFullYear()).slice(-2)}`;
  }

  return monthLabel(date);
}

export function timeAxisTicks(t0, span, maxTicks = 8) {
  const end = t0 + span;
  const scale = timeAxisScale(span);
  const tickCount = Math.max(1, Math.floor(maxTicks || 1));

  if (scale === "time") {
    if (tickCount === 1) return [t0];
    return Array.from(
      { length: tickCount },
      (_, index) => t0 + span * (index / (tickCount - 1)),
    );
  }

  const ticks = [t0];
  const cursor = new Date(t0);

  if (scale === "day") {
    cursor.setHours(0, 0, 0, 0);

    const visibleDays = Math.ceil(span / DAY);
    const step = Math.max(1, Math.ceil(visibleDays / tickCount));

    while (cursor.getTime() < end) {
      if (cursor.getTime() > t0) ticks.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + step);
    }

    return limitTicks(ticks, tickCount);
  }

  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  const visibleMonths = Math.max(1, Math.ceil(span / MONTH));
  const step = Math.max(1, Math.ceil(visibleMonths / tickCount));

  while (cursor.getTime() < end) {
    if (cursor.getTime() > t0) ticks.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + step);
  }

  return limitTicks(ticks, tickCount);
}

function limitTicks(ticks, maxTicks) {
  return ticks.slice(0, maxTicks);
}
