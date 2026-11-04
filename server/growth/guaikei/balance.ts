type MoneyRecord = { id: number; path: string; single: number; balance: number; created_at: string };
type Page = { errcode: number; data?: { balance?: number; list?: MoneyRecord[] } };
export type GuaikeiBalance = { checkedAt: string; balanceCents: number | null; todaySpentCents: number;
  todayByPlatform: Record<string, number>; todayComplete: boolean; lowBalance: boolean | null;
  ledgerBalanceCents: number | null; balanceConsistent: boolean; error?: string };

async function readPage(page: number): Promise<Page> {
  const token = process.env.GUAIKEI_API_TOKEN?.trim();
  if (!process.env.FLY_APP_NAME || !token) throw Error("Fly未配置采集Token");
  const url = new URL("https://www.guaikei.com/api/token/numbers");
  url.searchParams.set("_", String(Math.floor(Date.now() / 1000)));
  url.searchParams.set("token", token); url.searchParams.set("page", String(page));
  // 官方只读接口要求query鉴权；URL和异常正文绝不进入日志或前端。
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error("供应商余额查询失败");
  const reader = response.body?.getReader();
  if (!reader) throw Error("供应商余额响应为空");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength; if (bytes > 2_000_000) throw Error("余额响应过大"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const cents = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
const day = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);

export async function readGuaikeiBalance(fetchPage = readPage, now = Date.now()): Promise<GuaikeiBalance> {
  const result: GuaikeiBalance = { checkedAt: new Date(now).toISOString(), balanceCents: null, todaySpentCents: 0,
    todayByPlatform: {}, todayComplete: false, lowBalance: null, ledgerBalanceCents: null, balanceConsistent: false };
  const seen = new Set<number>();
  try {
    for (let page = 1; page <= 20; page++) {
      const response = await fetchPage(page);
      if (response.errcode !== 0 || !Array.isArray(response.data?.list)) throw Error("余额响应格式错误");
      if (page === 1) {
        result.balanceCents = cents(response.data.balance);
        if (result.balanceCents === null) throw Error("余额字段缺失");
        result.lowBalance = result.balanceCents < 500;
      }
      const rows = response.data!.list!;
      if (!rows.length) { result.todayComplete = true; break; }
      let reachedEarlier = false, added = 0;
      for (const row of rows) {
        if (!Number.isSafeInteger(row.id) || seen.has(row.id)) continue;
        seen.add(row.id); added++;
        const at = Date.parse(row.created_at);
        const cost = cents(row.single);
        if (!Number.isFinite(at) || cost === null) throw Error("资金记录格式错误");
        if (result.ledgerBalanceCents === null && cents(row.balance) !== null) result.ledgerBalanceCents = cents(row.balance)! - cost;
        if (day(at) < day(now)) { reachedEarlier = true; continue; }
        if (day(at) !== day(now)) continue;
        const platform = row.path.startsWith("weixin/video") || row.path.startsWith("wechat/video") ? "wechat"
          : row.path.startsWith("weixin/article") || row.path.startsWith("wechat/article") ? "wechat_articles"
            : String(row.path).split("/")[0];
        result.todaySpentCents += cost;
        result.todayByPlatform[platform] = (result.todayByPlatform[platform] || 0) + cost;
      }
      if (reachedEarlier) { result.todayComplete = true; break; }
      if (!added) break;
    }
    result.balanceConsistent = result.ledgerBalanceCents === null || result.ledgerBalanceCents === result.balanceCents;
    // 两个供应商字段口径不同，保留原值并告知核对，不能悄悄改写成推算余额。
    return result;
  } catch {
    return { ...result, balanceCents: null, lowBalance: null, todayComplete: false, error: "供应商余额未确认，请稍后刷新；未读取或显示Token" };
  }
}
