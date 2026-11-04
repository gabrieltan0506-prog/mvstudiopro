import type { GuaikeiItem, GuaikeiRequest } from "@shared/guaikei";

export function requestContract(input: GuaikeiRequest) {
  const base = input.platform === "wechat"
    ? `/api/wechat/${input.operation === "articles" ? "article" : "video"}-search`
    : input.operation === "posts" ? `/api/${input.platform}/post`
    : input.platform === "douyin" ? "/api/douyin/general-search"
    : input.platform === "xiaohongshu" ? "/api/xiaohongshu/note-search"
    : `/api/${input.platform}/search`;
  const params: Record<string, string | number> = { [input.operation === "posts" ? "url" : "keyword"]: input.query, limit: input.limit };
  // 旧任务无searchOrder保持原参数，GET恢复不得更换供应商查询身份。
  if (input.operation !== "posts") params[input.platform === "douyin" || input.platform === "tiktok" ? "sort_type" : "sort"] = input.searchOrder === "hot"
    ? input.platform === "wechat" || input.platform === "xiaohongshu" ? 2 : input.platform === "douyin" ? 1 : 0
    : 0;
  return { create: `${base}/${input.operation === "posts" ? "url" : "keyword"}`, poll: `${base}/info`, params };
}

type Row = Record<string, any>;
const obj = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, max = 2000) => typeof value === "string" || typeof value === "number" ? String(value).slice(0, max) : "";
// 搜索结果的高亮标签不是正文；React仍按纯文本显示其他内容。
const displayText = (value: unknown, max = 2000) => text(value, max).replace(/<\/?em\b[^>]*>/gi, "").trim();
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
}
function safeUrl(value: unknown): string | null {
  try { const u = new URL(text(value, 3000)); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function date(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value); const n = Number(value);
  // 无时区的供应商文本时间不猜本机时区；保留原始响应供核验。
  const ms = Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : /T.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) && ms > 0 && ms <= Date.now() + 86400000 ? new Date(ms).toISOString() : null;
}

export function normalizeProviderData(input: GuaikeiRequest, data: unknown) {
  const root = obj(data);
  let rows: unknown[] | undefined = Array.isArray(data) ? data : undefined;
  // 仅接文档声明的列表包装；未知形状明确失败，不用空数组冒充成功。
  for (const key of ["list", "items", "data", "post", "note", "posts", "notes"]) {
    if (!rows && Array.isArray(root[key])) rows = root[key];
  }
  if (!rows) throw new Error("供应商结果不是已知列表结构，已保留原始结果供检查");
  if (rows.length > 1000) throw new Error("供应商返回量超出安全上限");
  const seen = new Set<string>(); const items: GuaikeiItem[] = [];
  let duplicateCount = 0, rejectedCount = 0;
  for (const raw of rows) {
    const wrapper = obj(raw);
    const row = { ...wrapper, ...obj(wrapper.post), ...obj(wrapper.note) };
    const user = { ...obj(root.user), ...obj(wrapper.user), ...obj(row.user) };
    const id = text(row.aweme_id ?? row.id ?? row.docid ?? row.exportid, 200);
    const title = displayText(row.title || (input.platform === "douyin" ? row.desc || row.caption : row.caption || row.desc));
    if (!id || !title) { rejectedCount++; continue; }
    if (seen.has(id)) { duplicateCount++; continue; }
    seen.add(id);
    const authorId = text(row.author_uid ?? row.author_id ?? user.user_id ?? user.uid ?? user.id ?? user.sec_uid, 200);
    let url = safeUrl(row.share_url ?? row.url);
    if (!url && input.platform === "douyin" && /^\d+$/.test(id)) url = `https://www.douyin.com/video/${id}`;
    if (!url && input.platform === "xiaohongshu" && /^[a-f\d]+$/i.test(id)) {
      const u = new URL(`https://www.xiaohongshu.com/explore/${id}`);
      if (row.xsec_token) { u.searchParams.set("xsec_token", text(row.xsec_token)); u.searchParams.set("xsec_source", "pc_search"); }
      url = u.href;
    }
    // 视频号等缺少文档中的公开链接时保持null，绝不编造可播放地址。
    items.push({ id, platform: input.platform, title, description: displayText(row.desc, 4000),
      author: displayText(row.author_nickname ?? row.author_name ?? user.nickname ?? user.user_name ?? user.name, 200), authorId, url,
      publishedAt: input.platform === "xiaohongshu"
        ? date(typeof row.publish_time === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.publish_time)
          ? row.publish_time.replace(" ", "T") + "+08:00" : row.publish_time)
        : date(row.create_time ?? row.pubtime ?? row.publish_time ?? row.timestamp ?? row.datetime),
      likes: number(row.digg_count ?? row.liked_count ?? row.like_count ?? row.like_num ?? row.likes),
      comments: number(row.comment_count ?? row.comments), shares: number(row.share_count ?? row.shared_count ?? row.share),
      views: number(row.play_count ?? row.view_count ?? row.view),
    });
  }
  if (items.length > input.limit) throw new Error("供应商返回条数超过请求上限，需检查合同");
  return { items, rawCount: rows.length, duplicateCount, rejectedCount };
}
