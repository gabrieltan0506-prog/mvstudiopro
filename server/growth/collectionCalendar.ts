/** 北京时间调度；周末（含调休上班日）和大陆节假日全天 live。 */
export type CollectionMode = "auto" | "live" | "backfill";

// 国办发明电〔2025〕7号；使用完整放假区间，不把调休周末改为回填日。
// https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html
const HOLIDAY_RANGES: Record<string, readonly (readonly [string, string])[]> = {
  "2026": [
    ["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"],
    ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"],
  ],
};
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", hourCycle: "h23",
});

export function resolveCollectionCalendar(now = new Date(), extraHolidays = process.env.GROWTH_HOLIDAY_DATES || "") {
  const parts = formatter.formatToParts(now);
  const get = (name: string) => parts.find(part => part.type === name)?.value || "";
  const year = get("year");
  const monthDay = `${get("month")}-${get("day")}`;
  const date = `${year}-${monthDay}`;
  const weekend = ["Sat", "Sun"].includes(get("weekday"));
  const calendarKnown = Object.prototype.hasOwnProperty.call(HOLIDAY_RANGES, year);
  const holiday = (HOLIDAY_RANGES[year] || []).some(([start, end]) => monthDay >= start && monthDay <= end)
    || extraHolidays.split(",").some(value => value.trim() === date);
  // 未核实新年度日历时保留 live，不把可能的节假日误当工作日回填。
  const mode = calendarKnown && !weekend && !holiday && Number(get("hour")) < 7 ? "backfill" : "live";
  return { mode: mode as "live" | "backfill", date, calendarKnown, weekend, holiday };
}

/** 保留管理端显式模式；部署后将持久化模式设为 auto 才应用日历。 */
export function resolveCollectionMode(mode: CollectionMode, now = new Date()): "live" | "backfill" {
  return mode === "auto" ? resolveCollectionCalendar(now).mode : mode;
}
