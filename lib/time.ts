/** 把时间戳解析成本地时间。无效的值和没有行情时的占位时间（1970 年）都视为没有时间。 */
function parseTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) || time.getUTCFullYear() < 2000 ? null : time;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** 卡片上的行情时间：今年显示「月-日 时:分」，跨年只显示日期。 */
export function formatMarketTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  const time = parseTime(iso);
  if (!time) return null;
  const day = `${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
  return time.getFullYear() === new Date(now).getFullYear() ? `${day} ${pad(time.getHours())}:${pad(time.getMinutes())}` : `${time.getFullYear()}-${day}`;
}

/** 完整的本地行情时间，用在悬停提示和方案详情里。 */
export function formatMarketTimeFull(iso: string | null | undefined): string | null {
  const time = parseTime(iso);
  return time ? time.toLocaleString("zh-CN", { hour12: false }) : null;
}
