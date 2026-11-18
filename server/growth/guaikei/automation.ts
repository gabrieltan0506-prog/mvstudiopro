import { assertGuaikeiLiveStore } from "./offlineRestore";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { defaultGuaikeiSettings, guaikeiSettingsSchema, guaikeiPlatforms, type GuaikeiSettings, type GuaikeiRequest } from "../../../shared/guaikei";
import { withGrowthStoreMutationLock } from "../growthStoreMutationLock";
import { guaikeiService, type GuaikeiService } from "./service";

type Platform = GuaikeiRequest["platform"];
type Run = { id: string; owner: number; platform: Platform; reason: string; at: string;
  requests: GuaikeiRequest[]; jobIds: string[]; status: "claimed" | "submitted" | "failed"; error?: string };
type State = { version: 1; owner: number; settings: GuaikeiSettings; slots: Record<string, string>;
  cursors: Partial<Record<Platform, number>>; lastAt: Partial<Record<Platform, string>>;
  native: Partial<Record<Platform, { at: string; added: number; previous: number }>>; runs: Run[] };

export function shanghaiSlot(now: number) {
  const local = new Date(now + 8 * 3600_000).toISOString();
  return { date: local.slice(0, 10), hour: Number(local.slice(11, 13)), hourKey: local.slice(0, 13) };
}

/** 普通频次与突增补采共用一个决策函数；没有消费目标，也没有补烧预算。 */
export function dueGuaikeiRun(state: State, platform: Platform, now: number): { slot: string; reason: string } | null {
  const cfg = state.settings.platforms[platform];
  if (!state.settings.enabled || !cfg.enabled || cfg.mode === "manual") return null;
  const local = shanghaiSlot(now);
  const lastAt = Date.parse(state.lastAt[platform] || "");
  const event = state.native[platform];
  if (cfg.surgeEnabled && event && event.previous > 0 && event.added >= cfg.surgeMinAdded
    && event.added >= event.previous * (1 + cfg.surgePercent / 100)
    && now - Date.parse(event.at) < 60 * 60_000
    && (!Number.isFinite(lastAt) || now - lastAt >= cfg.surgeCooldownMinutes * 60_000)) {
    const slot = `surge:${platform}:${event.at}`;
    if (!state.slots[slot]) return { slot, reason: "原Growth本轮新增明显超过上轮，补充近期内容" };
  }
  const hour = cfg.mode === "hourly" ? local.hour : cfg.hours.find(h => local.hour >= Math.max(0, h - 1) && local.hour < Math.min(24, h + 1));
  if (hour === undefined) return null;
  const slot = `${platform}:${local.date}:${hour}`;
  if (state.slots[slot]) return null;
  // 突增刚刚补采时，不在同一小时再叠加常规付费请求。
  if (Number.isFinite(lastAt) && now - lastAt < 60 * 60_000) return null;
  return { slot, reason: cfg.mode === "hourly" ? "每小时补采" : "每日时间窗口补采" };
}

export class GuaikeiAutomation {
  private root: string;
  private service: Pick<GuaikeiService, "quote" | "submit" | "pending" | "poll">;
  private running = false;
  constructor(deps: { root?: string; service?: GuaikeiAutomation["service"] } = {}) {
    this.root = deps.root || path.join(process.env.GROWTH_STORE_DIR || path.join(process.cwd(), ".cache/growth"), "paid-research/guaikei");
    this.service = deps.service || guaikeiService;
  }
  private async read(): Promise<State> {
    try {
      const state = JSON.parse(await fs.readFile(path.join(this.root, "automation.json"), "utf8"));
      if (state.version !== 1 || !Number.isSafeInteger(state.owner) || state.owner < 0
        || !state.slots || !state.cursors || !state.native || !state.lastAt || !Array.isArray(state.runs)) throw Error("调度台账损坏，已停止新增采集");
      state.settings = guaikeiSettingsSchema.parse(state.settings);
      for (const run of state.runs) {
        if (!run.id || !guaikeiPlatforms.includes(run.platform) || !Array.isArray(run.requests) || !Array.isArray(run.jobIds)
          || !["claimed", "submitted", "failed"].includes(run.status)) throw Error("调度任务损坏，已停止新增采集");
      }
      return state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return { version: 1, owner: 0, settings: defaultGuaikeiSettings(), slots: {}, cursors: {}, lastAt: {}, native: {}, runs: [] };
    }
  }
  private async write(state: State) {
    await fs.mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, `automation.${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, path.join(this.root, "automation.json"));
  }
  private locked<T>(fn: () => Promise<T>) { return withGrowthStoreMutationLock("guaikei-automation", fn); }
  async settings() { const state = await this.read(); return { settings: state.settings, owner: state.owner, runs: state.runs.slice(-20).reverse() }; }
  /** 仅自动轮次的自有任务进入公共池，手动任务及缓存复用任务不公开。 */
  async publicJobs(getJob = (owner: number, id: string) => guaikeiService.get(owner, id)) {
    const state = await this.read();
    const jobs = [];
    for (const run of [...state.runs].reverse()) {
      for (const id of run.jobIds) {
        const job = await getJob(run.owner, id);
        const ownedRequest = run.requests.some((_, i) => job.requestId === createHash("sha256").update(`${run.id}:${i}`).digest("hex"));
        if (job.owner === run.owner && ownedRequest && job.status === "completed" && job.input.operation === "search") jobs.push(job);
      }
    }
    return jobs;
  }
  async save(owner: number, raw: GuaikeiSettings) {
    const settings = guaikeiSettingsSchema.parse(raw);
    await this.locked(async () => { const state = await this.read(); state.owner = owner; state.settings = settings; await this.write(state); });
    return this.settings();
  }
  async nativeGrowth(platform: string, added: number, previous: number, at: string) {
    if (platform !== "douyin" && platform !== "xiaohongshu") return;
    if (![added, previous].every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isFinite(Date.parse(at))) return;
    await this.locked(async () => { const state = await this.read(); state.native[platform] = { at, added, previous }; await this.write(state); });
  }
  private async execute(run: Run) {
    for (let i = 0; i < run.requests.length; i++) {
      const input = run.requests[i];
      const quote = await this.service.quote(input);
      // 持久化的同一轮始终使用相同ID；崩溃/重复tick不会重复POST。
      const id = createHash("sha256").update(`${run.id}:${i}`).digest("hex");
      const job = await this.service.submit(run.owner, input, id, quote.reservedCents, true);
      await this.locked(async () => {
        const state = await this.read(), saved = state.runs.find(row => row.id === run.id);
        if (!saved) throw Error("采集轮次丢失，停止新增请求");
        if (!saved.jobIds.includes(job.id)) saved.jobIds.push(job.id);
        await this.write(state);
      });
    }
    await this.locked(async () => { const state = await this.read(); state.runs.find(row => row.id === run.id)!.status = "submitted"; await this.write(state); });
  }
  async tick(now = Date.now()) {
    await assertGuaikeiLiveStore(this.root);
    if (this.running) return;
    this.running = true;
    try {
      const initial = await this.read();
      // 仅查询原任务；调度关闭也允许已提交任务安全收尾。
      for (const job of (await this.service.pending()).slice(0, 10)) {
        try { await this.service.poll(job.owner, job.id); }
        catch { console.warn("[guaikei] 原任务查询失败，保留任务并继续查询其余结果"); }
      }
      if (!initial.owner) return;
      const due = await this.locked(async () => {
        const state = await this.read();
        if (!state.settings.enabled) return [] as Run[];
        const pending = state.runs.filter(r => r.status === "claimed");
        for (const platform of guaikeiPlatforms) {
          if (pending.some(r => r.platform === platform)) continue;
          const decision = dueGuaikeiRun(state, platform, now);
          if (!decision) continue;
          const cfg = state.settings.platforms[platform], cursor = state.cursors[platform] || 0;
          const requests = Array.from({ length: cfg.rounds }, (_, i) => ({ platform, operation: "search" as const,
            query: cfg.keywords[(cursor + i) % cfg.keywords.length], limit: cfg.limit, searchOrder: "hot" as const }));
          const run: Run = { id: decision.slot, owner: state.owner, platform, reason: decision.reason, at: new Date(now).toISOString(), requests, jobIds: [], status: "claimed" };
          state.slots[decision.slot] = run.at; state.cursors[platform] = cursor + cfg.rounds; state.lastAt[platform] = run.at;
          state.runs.push(run); pending.push(run);
        }
        // 轮次是公共作品的来源索引，15天报告与审计仍需读取，不按7天清除。
        state.slots = Object.fromEntries(Object.entries(state.slots).filter(([, at]) => now - Date.parse(at) < 7 * 86400_000));
        await this.write(state); return pending;
      });
      for (const run of due) {
        try { await this.execute(run); }
        catch {
          await this.locked(async () => { const state = await this.read(), saved = state.runs.find(r => r.id === run.id); if (saved) { saved.status = "failed"; saved.error = "采集未能继续；保留原任务，不自动重投"; } await this.write(state); });
        }
      }
    } finally { this.running = false; }
  }
}
export const guaikeiAutomation = new GuaikeiAutomation();
let timer: ReturnType<typeof setInterval> | undefined;
export function startGuaikeiAutomation() {
  if (timer || process.env.FLY_PROCESS_GROUP !== "app") return;
  const run = () => void guaikeiAutomation.tick().catch(() => console.warn("[guaikei] 调度读取失败，未启动新的采集"));
  timer = setInterval(run, 60_000); timer.unref(); run();
}
