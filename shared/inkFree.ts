/** 映客 INK：每日全站十个新账号，单账号累计一次，PPTX/MP4共用。 */
export const INK_DAILY_NEW_ACCOUNTS = 10;
export const INK_FREE_PPT_PAGES = 10;
export const INK_FREE_FILE_MAX = 3;
export const INK_FREE_POLICY =
  "每天前10个新账号可免费导出一份视频，每个账号累计仅一次。次日不恢复，换IP不重置。PPTX免费入口尚未开放。";
export type InkFreeQuote = {
  day: string;
  eligible: boolean;
  reason:
    | "available"
    | "account_used"
    | "account_pending"
    | "ip_used"
    | "daily_full";
  remainingAccounts: number;
  jobId?: string;
  format?: "pptx" | "mp4";
};
export function inkFreeMessage(quote: InkFreeQuote): string {
  if (quote.reason === "account_used")
    return "这个账号已使用过唯一一次免费机会，次日不会恢复。可继续下载已有作品。";
  if (quote.reason === "account_pending")
    return "这个账号已有免费任务正在处理，请查看原任务；不会重复提交。";
  if (quote.reason === "ip_used")
    return "当前IP今天已领取免费名额，不能换账号重复领取。";
  if (quote.reason === "daily_full")
    return "今天的10个免费名额已领完；未使用过福利的账号可明天再来。";
  return `今天还可领取 ${quote.remainingAccounts} 个名额；你的账号累计仅有一次免费机会。`;
}
