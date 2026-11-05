import type { GuaikeiJob, GuaikeiReportRefs, GuaikeiTrendSnapshot } from "../../shared/guaikei";
import { guaikeiReportRefsSchema } from "../../shared/guaikei";
import { getShanghaiVisualReportWindows } from "../growth/time";
import { guaikeiAutomation } from "../growth/guaikei/automation";
import { guaikeiService } from "../growth/guaikei/service";

/** 扣费前冻结本人选择的作品；工作机不依赖正式机的本地采集目录。 */
export async function prepareGuaikeiTrendSnapshot(args: {
  owner: number; role: string; refs?: GuaikeiReportRefs; platforms: string[]; windowDays: number; anchorMs?: number;
}, getJob: (owner: number, id: string) => Promise<GuaikeiJob> = (owner, id) => guaikeiService.get(owner, id), getPublicJobs: () => Promise<GuaikeiJob[]> = () => guaikeiAutomation.publicJobs()): Promise<GuaikeiTrendSnapshot | undefined> {
  const refs = guaikeiReportRefsSchema.parse(args.refs || []);
  if (refs.length && args.role !== "admin") throw new Error("外部采集资料仅限所属管理员使用");
  const anchorMs = args.anchorMs ?? Date.now();
  const bounds = getShanghaiVisualReportWindows(args.windowDays, anchorMs);
  const items: GuaikeiTrendSnapshot["items"] = [];
  const seen = new Set<string>();
  if (!refs.length) {
    const candidates = (await getPublicJobs()).flatMap(job => job.items.map(item => ({
      ...item, reportPlatform: job.input.platform === "wechat" ? "weixin_channels" : job.input.platform,
      jobId: job.id, query: job.input.query, collectedAt: job.updatedAt,
    }))).filter(item => {
      const published = Date.parse(item.publishedAt || "");
      return args.platforms.includes(item.reportPlatform) && item.author.trim() && item.title.trim()
        && Number.isFinite(published) && published >= bounds.currentStart && published <= anchorMs;
    });
    // 先跨检索词选取，再按真实互动量补充；不把检索词或缺失指标伪装成热点。
    candidates.sort((a,b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0));
    const queries = new Set<string>();
    const ordered = candidates.filter(item => { const key = `${item.reportPlatform}:${item.query}`; if(queries.has(key)) return false; queries.add(key); return true; });
    for (const item of [...ordered, ...candidates]) {
      const key = `${item.reportPlatform}:${item.id}`;
      if (seen.has(key) || items.length >= 20) continue;
      if (JSON.stringify([...items, item]).length > 23000) continue;
      seen.add(key); items.push(item);
    }
    if (args.platforms.some(p => ["weixin_channels", "tiktok"].includes(p)) && items.length < 2) {
      throw new Error("所选时间范围暂时没有足够的内容生成报告，请稍后再试；未扣费");
    }
    return { owner: args.owner, anchorMs, windowDays: args.windowDays, platforms: [...args.platforms], items };
  }
  for (const ref of refs) {
    const job = await getJob(args.owner, ref.jobId);
    if (job.owner !== args.owner || job.status !== "completed") throw new Error("外部采集任务不属于当前用户或尚未成功");
    const reportPlatform = job.input.platform === "wechat"
      ? job.input.operation === "articles" ? "wechat_articles" : "weixin_channels"
      : job.input.platform;
    for (const id of ref.itemIds) {
      const item = job.items.find(row => row.id === id);
      if (!item || item.platform !== job.input.platform) throw new Error("选中的外部作品已不可用；未扣费");
      const published = Date.parse(item.publishedAt || "");
      if (!Number.isFinite(published) || published < bounds.currentStart || published >= bounds.currentEndExclusive) {
        throw new Error("外部作品缺少发布时间或不在报告时间范围内，请调整选择；未扣费");
      }
      const key = `${reportPlatform}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...item, reportPlatform, jobId: job.id, query: job.input.query, collectedAt: job.updatedAt });
    }
  }
  const snapshot = { owner: args.owner, anchorMs, windowDays: args.windowDays, platforms: [...args.platforms], items };
  if (JSON.stringify(snapshot).length > 24_000) throw new Error("外部资料超过报告容量，请减少选择；未扣费，不截断正文");
  return snapshot;
}

/** 原库与定向采集只合并内容证据，统计对照仍由原库独立计算。 */
export function combineGuaikeiTrendEvidence(snapshot: GuaikeiTrendSnapshot | undefined, native: Array<{ platform: string; items: Array<{ id?: string; url?: string }> }>) {
  if (!snapshot) return [];
  return snapshot.items.filter(item => {
    const base = native.find(row => row.platform === item.reportPlatform)?.items || [];
    const canonicalUrl = (url: string | null | undefined) => {
      try { const u = new URL(url || ""); return `${u.hostname}${u.pathname.replace(/\/$/, "")}`; } catch { return ""; }
    };
    return !base.some(row => String(row.id || "") === item.id
      || (canonicalUrl(item.url) && canonicalUrl(row.url) === canonicalUrl(item.url)));
  });
}

export function assertGuaikeiTrendSnapshot(snapshot: GuaikeiTrendSnapshot, owner: number, platforms: string[], windowDays: number) {
  if (snapshot.owner !== owner || snapshot.windowDays !== windowDays || !Number.isFinite(snapshot.anchorMs)
    || JSON.stringify(snapshot.platforms) !== JSON.stringify(platforms) || !Array.isArray(snapshot.items) || snapshot.items.length > 20) {
    throw new Error("趋势报告外部证据快照与任务不匹配");
  }
}
