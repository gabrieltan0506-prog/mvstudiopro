/**
 * 平台生圖 / DR-Pro / 中文編導暫存等流水線日誌的時間前綴：固定 **Asia/Shanghai（UTC+8）**，
 * 與運營對齊；不依賴伺服器本機時區。
 */
const shanghaiFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  fractionalSecondDigits: 3,
});

export function platformFlowLogTimestamp(date: Date = new Date()): string {
  return `${shanghaiFormatter.format(date)} Asia/Shanghai`;
}
