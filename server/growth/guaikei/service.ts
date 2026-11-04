import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { guaikeiRequestSchema, guaikeiNewRequestSchema, type GuaikeiJob, type GuaikeiRequest, recentGuaikeiItems, type GuaikeiWindow } from "@shared/guaikei";
import { withGrowthStoreMutationLock } from "../growthStoreMutationLock";
import { normalizeProviderData, requestContract } from "./provider";

type Index = { version: 1; jobs: GuaikeiJob[] };
type Payload = { errcode: number; data?: unknown };
type Dependencies = {
  root?: string;
  request?: (input: GuaikeiRequest, method: "POST" | "GET") => Promise<Payload>;
  ready?: () => boolean;
};
const active = (job: GuaikeiJob) => ["submitting", "pending", "unknown"].includes(job.status);
const fingerprint = (input: GuaikeiRequest) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const day = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const configuredInt = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name}配置无效`);
  return n;
};

async function requestProvider(input: GuaikeiRequest, method: "POST" | "GET"): Promise<Payload> {
  if (!process.env.FLY_APP_NAME || !process.env.GUAIKEI_API_TOKEN?.trim()) throw new Error("仅允许已配置Token的Fly服务端调用");
  const contract = requestContract(input);
  const url = new URL(method === "POST" ? contract.create : contract.poll, "https://www.guaikei.com");
  url.searchParams.set("_", String(Math.floor(Date.now() / 1000)));
  if (method === "GET") Object.entries(contract.params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    method, redirect: "error", signal: AbortSignal.timeout(25_000),
    headers: { TOKEN: process.env.GUAIKEI_API_TOKEN.trim(), "Content-Type": "application/json", Accept: "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(contract.params) } : {}),
  });
  if (!response.ok) throw new Error(`供应商HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("供应商响应为空");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error("供应商响应超过2MB上限");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!result || !Number.isInteger(result.errcode)) throw new Error("供应商响应缺少errcode");
  // 不传播供应商原始errmsg，防止错误正文回显凭证。
  return { errcode: result.errcode, data: result.data };
}

export class GuaikeiService {
  private root: string;
  private request: NonNullable<Dependencies["request"]>;
  private ready: NonNullable<Dependencies["ready"]>;
  constructor(deps: Dependencies = {}) {
    this.root = deps.root || path.join(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache/growth"), "paid-research/guaikei");
    this.request = deps.request || requestProvider;
    this.ready = deps.ready || (() => Boolean(process.env.FLY_APP_NAME && process.env.GUAIKEI_API_TOKEN?.trim()));
  }
  private async read(): Promise<Index> {
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.root, "index.json"), "utf8"));
      if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error("采集台账格式无效，禁止继续扣费");
      const ids = new Set<string>();
      const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      for (const job of data.jobs) {
        if (!job || typeof job.id !== "string" || !/^[a-f0-9-]{36}$/i.test(job.id) || ids.has(job.id)
          || !Number.isSafeInteger(job.owner) || job.owner <= 0
          || typeof job.createdAt !== "string" || !Number.isFinite(Date.parse(job.createdAt))
          || !cents(job.reservedCents) || !(job.actualCents === null || cents(job.actualCents))
          || !["submitting", "pending", "unknown", "failed", "completed", "empty"].includes(job.status)
          || !guaikeiRequestSchema.safeParse(job.input).success || !Array.isArray(job.items)) {
          throw new Error("采集台账记录损坏，禁止继续扣费；请保留原文件核查");
        }
        ids.add(job.id);
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, jobs: [] };
      throw error;
    }
  }
  private async write(file: string, data: unknown) {
    await fs.mkdir(this.root, { recursive: true });
    const target = path.join(this.root, file), temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, target);
    // 提交前台账必须持久化；崩溃恢复只GET原任务，不重复POST。
    const directory = await fs.open(this.root, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  private locked<T>(work: () => Promise<T>) { return withGrowthStoreMutationLock("guaikei-ledger", work); }
  private quoteInput(input: GuaikeiRequest) {
    const batchSize = input.platform === "wechat" ? configuredInt("GUAIKEI_WECHAT_BATCH_SIZE", 0)
      : input.operation === "posts" ? (input.platform === "tiktok" ? 10 : 20)
      : input.platform === "douyin" ? 19 : input.platform === "kuaishou" || input.platform === "tiktok" || input.platform === "xiaohongshu" ? 10 : 20;
    const unitCents = input.platform === "wechat" ? 15 : 10;
    return { estimatedCents: batchSize ? Math.ceil(input.limit / batchSize) * unitCents : null,
      // 已核平台按请求上限向上取整预占；微信批量未知时按最保守的一条一批。
      reservedCents: batchSize ? Math.ceil(input.limit / batchSize) * unitCents : input.limit * unitCents,
      blockedReason: !this.ready() ? "Fly尚未配置GUAIKEI_API_TOKEN" : null,
    };
  }
  async quote(raw: GuaikeiRequest) {
    const input = guaikeiNewRequestSchema.parse(raw);
    const index = await this.read(); const today = day(new Date().toISOString());
    const currentMonth = today.slice(0, 7);
    const spent = (prefix: string) => index.jobs.filter(j => day(j.createdAt).startsWith(prefix)).reduce((n, j) => n + (j.actualCents ?? j.reservedCents), 0);
    return { ...this.quoteInput(input), input, configured: this.ready(), dailyReservedCents: spent(today), monthlyReservedCents: spent(currentMonth),
      dailyLimitCents: configuredInt("GUAIKEI_DAILY_BUDGET_CENTS", 0), monthlyLimitCents: configuredInt("GUAIKEI_MONTHLY_BUDGET_CENTS", 0),
      note: "已核平台按请求上限与批量向上取整预占；微信批量未知时按每条一批保守预占。失败也保留，实际费用须核供应商资金记录。" };
  }
  async list(owner: number) { return (await this.read()).jobs.filter(j => j.owner === owner).map(j => ({ ...j, items: [] })).slice(-50).reverse(); }
  /** 调度恢复不能套用UI最近50条截断；最久未查询优先，避免未知任务饿死后续结果。 */
  async pending() {
    return (await this.read()).jobs.filter(active).sort((a, b) =>
      Date.parse(a.lastPolledAt || a.createdAt) - Date.parse(b.lastPolledAt || b.createdAt)
    ).map(({ id, owner }) => ({ id, owner }));
  }
  async get(owner: number, id: string, windowDays: GuaikeiWindow = 15) {
    const job = (await this.read()).jobs.find(j => j.owner === owner && j.id === id);
    if (!job) throw new Error("任务不存在或无权访问");
    let sourceItems = job.items;
    if (job.input.platform === "xiaohongshu" && job.normalizationVersion !== 2 && job.status === "completed") {
      // 旧版timestamp可能是更新时刻；必须回到原始发布时间，缺回执不冒充近期。
      try {
        const raw = JSON.parse(await fs.readFile(path.join(this.root, `${job.id}.raw.json`), "utf8"));
        sourceItems = normalizeProviderData(job.input, raw.data).items;
      } catch { sourceItems = job.items.map(item => ({ ...item, publishedAt: null })); }
    }
    const items = recentGuaikeiItems(sourceItems, windowDays);
    return { ...job, items, excludedByWindow: job.items.length - items.length };
  }
  async submit(owner: number, raw: GuaikeiRequest, requestId: string, confirmedReservedCents: number, refresh = false) {
    const input = guaikeiNewRequestSchema.parse(raw);
    let shouldCreate = false;
    const saved = await this.locked(async () => {
      const index = await this.read(); const hash = fingerprint(input);
      const duplicate = index.jobs.find(j => j.owner === owner && j.requestId === requestId);
      if (duplicate) {
        if (duplicate.fingerprint !== hash) throw new Error("同一提交标识不能更换输入");
        return duplicate;
      }
      const cached = [...index.jobs].reverse().find(j => j.owner === owner && j.fingerprint === hash && (active(j) || (!refresh && ["completed", "empty"].includes(j.status) && Date.now() - Date.parse(j.createdAt) < 86400_000)));
      if (cached) return cached;
      const q = await this.quote(input);
      if (q.blockedReason) throw new Error(q.blockedReason);
      if (q.reservedCents !== confirmedReservedCents) throw new Error("请重新查看并确认本次费用预占");
      if ((q.dailyLimitCents > 0 && q.dailyReservedCents + q.reservedCents > q.dailyLimitCents) || (q.monthlyLimitCents > 0 && q.monthlyReservedCents + q.reservedCents > q.monthlyLimitCents)) throw new Error("达到采集预算，禁止新增请求");
      if (index.jobs.length >= 1000) throw new Error("采集台账已达容量上限，请先审查归档方案");
      const now = new Date().toISOString();
      const job: GuaikeiJob = { id: randomUUID(), owner, requestId, fingerprint: hash, input, status: "submitting", createdAt: now, updatedAt: now,
        message: "已登记并预占预算；提交结果不明时只查询原任务", reservedCents: q.reservedCents, estimatedCents: q.estimatedCents, actualCents: null,
        items: [], rawCount: 0, duplicateCount: 0, rejectedCount: 0 };
      index.jobs.push(job); await this.write("index.json", index); shouldCreate = true; return job;
    });
    if (!shouldCreate) return saved;
    let status: GuaikeiJob["status"] = "unknown", message = "提交结果不明；请查询原任务，不要重复创建";
    try {
      const response = await this.request(input, "POST");
      await this.write(`${saved.id}.${randomUUID()}.submit.raw.json`, { receivedAt: new Date().toISOString(), ...response });
      status = response.errcode === 0 ? "pending" : response.errcode > 0 && response.errcode < 10 ? "unknown" : "failed";
      message = response.errcode === 0 ? "供应商已接受，请查询结果" : `供应商错误码${response.errcode}；费用未核实，预占保留`;
    } catch { /* 网络结果不明，持久化unknown；不重试POST。 */ }
    return this.update(owner, saved.id, job => { if (job.status === "submitting") Object.assign(job, { status, message }); });
  }
  private async update(owner: number, id: string, apply: (job: GuaikeiJob) => void) {
    return this.locked(async () => {
      const index = await this.read(), job = index.jobs.find(j => j.id === id && j.owner === owner);
      if (!job) throw new Error("任务不存在或无权访问");
      apply(job); job.updatedAt = new Date().toISOString(); await this.write("index.json", index); return job;
    });
  }
  async poll(owner: number, id: string) {
    const current = await this.get(owner, id);
    if (!active(current) || (current.status === "submitting" && Date.now() - Date.parse(current.createdAt) < 30_000)) return current;
    let query = false;
    const job = await this.update(owner, id, j => {
      if (active(j) && (!j.lastPolledAt || Date.now() - Date.parse(j.lastPolledAt) >= 5000)) { j.lastPolledAt = new Date().toISOString(); query = true; }
    });
    if (!query) return job;
    let response: Payload;
    try { response = await this.request(job.input, "GET"); }
    catch { return this.update(owner, id, j => { if (active(j)) { j.status = "unknown"; j.message = "结果查询失败，可继续查询同一任务；没有重新提交"; } }); }
    const receipt = `${job.id}.${randomUUID()}`;
    await this.write(`${receipt}.raw.json`, { receivedAt: new Date().toISOString(), errcode: response.errcode, data: response.data });
    if (response.errcode !== 0) return this.update(owner, id, j => {
      if (!active(j)) return;
      j.status = response.errcode > 0 && response.errcode < 10 ? "pending" : "failed";
      j.message = `供应商错误码${response.errcode}；${j.status === "pending" ? "稍后查询" : "需检查参数或账号，不自动重投"}`;
    });
    // 原始结果先落盘，即使标准化失败也可核查；不经前端暴露原始响应。
    // 兼容旧审计路径，但不得覆盖第一次已保存的原始结果；并发查询各自保留独立回执。
    try { await fs.link(path.join(this.root, `${receipt}.raw.json`), path.join(this.root, `${job.id}.raw.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    try {
      const normalized = normalizeProviderData(job.input, response.data);
      await this.write(`${receipt}.normalized.json`, normalized);
      return this.update(owner, id, j => {
        if (!active(j)) return;
        Object.assign(j, normalized, { normalizationVersion: 2 }); j.status = normalized.items.length ? "completed" : "empty";
        j.message = normalized.rawCount && !normalized.items.length ? "返回数据均缺少核心ID或标题，不能用于分析" : "结果已保存；请检查质量并核对供应商真实费用";
      });
    } catch { return this.update(owner, id, j => { if (active(j)) { j.status = "failed"; j.message = "结果结构或条数不符合合同，原始响应已保留；不自动重投"; } }); }
  }
}
export const guaikeiService = new GuaikeiService();
