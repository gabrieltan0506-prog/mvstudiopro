/**
 * Carbon 创建期等待的「按数据动态决定」（1111 站长：不要写死 60 / 90 / 150 秒，要看给的资料与数据）。
 *
 * - 每次流式调用都记一条首段耗时：成功记 firstDataMs，创建期没回应 / 首段前断线记 null（算创建失败）。
 * - 进程内按「通道 × 输入规模桶」保留最近 N 条成功样本，按通道保留最近 M 次创建结果（算失败率）。
 * - createTimeoutMs = clamp(max(规模基线, 2 × 该桶近期成功首段 P90), 30s, 300s)；样本不足用规模基线。
 * - 重新创建次数：该通道最近 10 次里创建失败 ≥ 7 → 0 次；≥ 4 → 1 次；否则 2 次。
 * - env GEMINI_CARBON_CREATE_TIMEOUT_MS / GEMINI_CARBON_CREATE_RETRIES 设了就强制覆盖（人工兜底）。
 * - 统计持久化到 GCS 小 JSON（只是统计，不是模型证据；可覆盖写）。读写失败一律静默降级为只用内存，绝不影响调用；
 *   第一次规划时懒加载；写入节流（每 10 条成功或距上次写入 ≥ 5 分钟）。
 *
 * 本文件只放纯函数与统计，不发网络请求；持久化读写由注入的 persist 完成。
 */
import type { GeminiCarbonChannel } from "../../shared/geminiCarbon";

export const GEMINI_CARBON_CREATE_TIMEOUT_FLOOR_MS = 30_000;
export const GEMINI_CARBON_CREATE_TIMEOUT_CEIL_MS = 300_000;
/**
 * 规模基线：45 秒 + 每 token 3.5 毫秒。
 * 依据（1111 线上实测）：短提示词首段约 19.5 秒，留 2 倍余量 ≈ 40 秒，取 45 秒作截距；
 * 3 万 token 量级的长提示在 Vertex 上首段明显变慢（2.1 万 token 正文调用总耗时约 314 秒），沿用原固定值 150 秒作为 3 万 token 的锚点，
 * 斜率 = (150 − 45) 秒 / 3 万 token = 3.5 毫秒 / token。约 7.3 万 token 触及 300 秒上限。
 */
export const GEMINI_CARBON_BASELINE_INTERCEPT_MS = 45_000;
export const GEMINI_CARBON_BASELINE_MS_PER_TOKEN = 3.5;
/** 媒体 part 的等效 token：按约 100 秒视频（≈300 token/秒）估 3 万 token，媒体请求基线与原固定 150 秒同量级。 */
export const GEMINI_CARBON_MEDIA_PART_TOKENS = 30_000;
/** 用历史 P90 至少需要的样本数（太少时 P90 不可信，仍用基线）。 */
export const GEMINI_CARBON_TIMING_MIN_SAMPLES = 3;
export const GEMINI_CARBON_TIMING_MAX_SAMPLES = 50;
export const GEMINI_CARBON_TIMING_ATTEMPT_WINDOW = 10;
export const GEMINI_CARBON_TIMING_OBJECT = "gemini-carbon/timing/first-data-stats.json";
export const GEMINI_CARBON_DEFAULT_CREATE_RETRIES_ADAPTIVE = 2;

export type GeminiCarbonSizeBucket = "lt2k" | "2k-8k" | "8k-30k" | "gt30k";
export const GEMINI_CARBON_SIZE_BUCKETS: readonly GeminiCarbonSizeBucket[] = ["lt2k", "2k-8k", "8k-30k", "gt30k"];

/**
 * 字符数估 token：中日韩字符按 1 字 ≈ 1 token、其余按 4 字符 ≈ 1 token（偏保守、宁可估大，估大只会让等待更长而不是误判失败）。
 */
export function estimateGeminiCarbonTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch)) cjk += 1; else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

export function geminiCarbonSizeBucket(tokens: number): GeminiCarbonSizeBucket {
  if (tokens < 2_000) return "lt2k";
  if (tokens < 8_000) return "2k-8k";
  if (tokens < 30_000) return "8k-30k";
  return "gt30k";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function geminiCarbonSizeBaselineMs(tokens: number): number {
  return clamp(Math.round(GEMINI_CARBON_BASELINE_INTERCEPT_MS + GEMINI_CARBON_BASELINE_MS_PER_TOKEN * Math.max(0, tokens)), GEMINI_CARBON_CREATE_TIMEOUT_FLOOR_MS, GEMINI_CARBON_CREATE_TIMEOUT_CEIL_MS);
}

/** P90（最近邻秩法）；空数组返回 null。 */
export function percentile90(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)]!;
}

const envInt = (value: unknown): number | undefined => {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

export type GeminiCarbonCreateTimeoutBasis = "history_p90" | "size_baseline" | "env";
export type GeminiCarbonCreateRetriesBasis = "failure_rate" | "env";

export type GeminiCarbonCreatePlan = {
  createTimeoutMs: number;
  basis: GeminiCarbonCreateTimeoutBasis;
  /** 该桶参与 P90 的成功样本数。 */
  samples: number;
  p90Ms: number | null;
  baselineMs: number;
  inputTokens: number;
  bucket: GeminiCarbonSizeBucket;
  createRetries: number;
  retriesBasis: GeminiCarbonCreateRetriesBasis;
  recentCreateFailures: number;
  recentAttempts: number;
};

/** 纯函数：给定样本与近期创建结果，算出本次创建期等待与重新创建次数。 */
export function planGeminiCarbonCreate(input: {
  inputTokens: number;
  successFirstDataMs: readonly number[];
  /** 该通道最近若干次创建结果，true = 创建失败。 */
  recentCreateFailed: readonly boolean[];
  env?: Record<string, string | undefined>;
}): GeminiCarbonCreatePlan {
  const env = input.env ?? {};
  const bucket = geminiCarbonSizeBucket(input.inputTokens);
  const baselineMs = geminiCarbonSizeBaselineMs(input.inputTokens);
  const samples = input.successFirstDataMs.length;
  const p90Ms = percentile90(input.successFirstDataMs);
  let createTimeoutMs: number;
  let basis: GeminiCarbonCreateTimeoutBasis;
  const envTimeout = envInt(env.GEMINI_CARBON_CREATE_TIMEOUT_MS);
  if (envTimeout) {
    createTimeoutMs = envTimeout;
    basis = "env";
  } else if (p90Ms !== null && samples >= GEMINI_CARBON_TIMING_MIN_SAMPLES && 2 * p90Ms > baselineMs) {
    createTimeoutMs = clamp(2 * p90Ms, GEMINI_CARBON_CREATE_TIMEOUT_FLOOR_MS, GEMINI_CARBON_CREATE_TIMEOUT_CEIL_MS);
    basis = "history_p90";
  } else {
    createTimeoutMs = baselineMs;
    basis = "size_baseline";
  }
  const window = input.recentCreateFailed.slice(-GEMINI_CARBON_TIMING_ATTEMPT_WINDOW);
  const recentCreateFailures = window.filter(Boolean).length;
  const envRetries = envInt(env.GEMINI_CARBON_CREATE_RETRIES);
  let createRetries: number;
  let retriesBasis: GeminiCarbonCreateRetriesBasis;
  if (envRetries !== undefined) {
    createRetries = envRetries;
    retriesBasis = "env";
  } else {
    createRetries = recentCreateFailures >= 7 ? 0 : recentCreateFailures >= 4 ? 1 : GEMINI_CARBON_DEFAULT_CREATE_RETRIES_ADAPTIVE;
    retriesBasis = "failure_rate";
  }
  return { createTimeoutMs, basis, samples, p90Ms, baselineMs, inputTokens: input.inputTokens, bucket, createRetries, retriesBasis, recentCreateFailures, recentAttempts: window.length };
}

export type GeminiCarbonTimingRecord = {
  channel: GeminiCarbonChannel;
  inputTokens: number;
  /** null = 创建失败（创建期没回应 / 首段前断线）。 */
  firstDataMs: number | null;
  /** 首段到达且 HTTP 2xx 才算成功样本，进 P90。 */
  ok: boolean;
  at: number;
};

type Sample = { firstDataMs: number; inputTokens: number; at: number };
type Attempt = { failed: boolean; at: number };
export type GeminiCarbonTimingSnapshot = {
  version: 1;
  updatedAt: number;
  samples: Record<string, Partial<Record<GeminiCarbonSizeBucket, Sample[]>>>;
  attempts: Record<string, Attempt[]>;
};

export type GeminiCarbonTimingPersist = {
  load: () => Promise<unknown>;
  save: (snapshot: GeminiCarbonTimingSnapshot) => Promise<void>;
};

export class GeminiCarbonTimingStore {
  private samples = new Map<string, Sample[]>();
  private attempts = new Map<string, Attempt[]>();
  private loaded: Promise<void> | undefined;
  private successSinceFlush = 0;
  private lastFlushAt: number;
  private flushing: Promise<void> | undefined;

  constructor(private readonly options: {
    persist?: GeminiCarbonTimingPersist;
    now?: () => number;
    maxSamples?: number;
    flushEvery?: number;
    flushIntervalMs?: number;
  } = {}) {
    this.lastFlushAt = this.now();
  }

  private now() { return (this.options.now ?? Date.now)(); }
  private get maxSamples() { return this.options.maxSamples ?? GEMINI_CARBON_TIMING_MAX_SAMPLES; }

  /** 懒加载一次；失败静默（只用内存）。已在内存里的样本保留在后（更新），加载的旧样本排在前。 */
  ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        if (!this.options.persist) return;
        try {
          const raw = (await this.options.persist.load()) as Partial<GeminiCarbonTimingSnapshot> | null | undefined;
          if (!raw || typeof raw !== "object") return;
          for (const [channel, buckets] of Object.entries(raw.samples ?? {})) {
            for (const [bucket, list] of Object.entries(buckets ?? {})) {
              const valid = (Array.isArray(list) ? list : []).filter((s): s is Sample => Number.isFinite(s?.firstDataMs) && s.firstDataMs >= 0);
              const key = `${channel}|${bucket}`;
              this.samples.set(key, [...valid, ...(this.samples.get(key) ?? [])].slice(-this.maxSamples));
            }
          }
          for (const [channel, list] of Object.entries(raw.attempts ?? {})) {
            const valid = (Array.isArray(list) ? list : []).filter((a): a is Attempt => typeof a?.failed === "boolean");
            this.attempts.set(channel, [...valid, ...(this.attempts.get(channel) ?? [])].slice(-GEMINI_CARBON_TIMING_ATTEMPT_WINDOW * 5));
          }
        } catch (error) {
          console.warn(`[geminiCarbonTiming] 统计读取失败，只用内存：${String((error as Error)?.message || error).slice(0, 160)}`);
        }
      })();
    }
    return this.loaded;
  }

  plan(channel: GeminiCarbonChannel, inputTokens: number, env?: Record<string, string | undefined>): GeminiCarbonCreatePlan {
    const bucket = geminiCarbonSizeBucket(inputTokens);
    return planGeminiCarbonCreate({
      inputTokens,
      successFirstDataMs: (this.samples.get(`${channel}|${bucket}`) ?? []).map((s) => s.firstDataMs),
      recentCreateFailed: (this.attempts.get(channel) ?? []).map((a) => a.failed),
      env,
    });
  }

  record(entry: GeminiCarbonTimingRecord): void {
    const attempts = this.attempts.get(entry.channel) ?? [];
    attempts.push({ failed: entry.firstDataMs === null, at: entry.at });
    this.attempts.set(entry.channel, attempts.slice(-GEMINI_CARBON_TIMING_ATTEMPT_WINDOW * 5));
    if (entry.ok && entry.firstDataMs !== null) {
      const key = `${entry.channel}|${geminiCarbonSizeBucket(entry.inputTokens)}`;
      const list = this.samples.get(key) ?? [];
      list.push({ firstDataMs: entry.firstDataMs, inputTokens: entry.inputTokens, at: entry.at });
      this.samples.set(key, list.slice(-this.maxSamples));
      this.successSinceFlush += 1;
    }
    this.maybeFlush();
  }

  snapshot(): GeminiCarbonTimingSnapshot {
    const samples: GeminiCarbonTimingSnapshot["samples"] = {};
    for (const [key, list] of this.samples) {
      const [channel, bucket] = key.split("|") as [string, GeminiCarbonSizeBucket];
      (samples[channel] ??= {})[bucket] = [...list];
    }
    return { version: 1, updatedAt: this.now(), samples, attempts: Object.fromEntries([...this.attempts].map(([k, v]) => [k, [...v]])) };
  }

  private maybeFlush() {
    const persist = this.options.persist;
    if (!persist || this.flushing) return;
    const due = this.successSinceFlush >= (this.options.flushEvery ?? 10)
      || (this.successSinceFlush > 0 && this.now() - this.lastFlushAt >= (this.options.flushIntervalMs ?? 5 * 60_000));
    if (!due) return;
    this.successSinceFlush = 0;
    this.lastFlushAt = this.now();
    // 先等懒加载完成再写，避免用只有内存几条的快照覆盖掉已持久化的历史。
    this.flushing = (async () => {
      try {
        await this.ensureLoaded();
        await persist.save(this.snapshot());
      } catch (error) {
        console.warn(`[geminiCarbonTiming] 统计写入失败，忽略：${String((error as Error)?.message || error).slice(0, 160)}`);
      } finally {
        this.flushing = undefined;
      }
    })();
  }

  /** 测试用：等待进行中的写入。 */
  async drain(): Promise<void> { await this.flushing; }
}

/** GCS 持久化（懒加载 gcs 模块）；对象不存在 / 无权限 / 未配置桶都由调用方静默降级。 */
export function createGeminiCarbonTimingGcsPersist(objectName = GEMINI_CARBON_TIMING_OBJECT): GeminiCarbonTimingPersist {
  return {
    load: async () => {
      const { downloadGcsObject, getGcsBucketName } = await import("./gcs");
      const bucket = getGcsBucketName();
      if (!bucket) return null;
      const { buffer } = await downloadGcsObject({ gcsUri: `gs://${bucket}/${objectName}` });
      return JSON.parse(buffer.toString("utf8")) as unknown;
    },
    save: async (snapshot) => {
      const { uploadBufferToGcs, getGcsBucketName } = await import("./gcs");
      if (!getGcsBucketName()) return;
      await uploadBufferToGcs({ objectName, buffer: Buffer.from(JSON.stringify(snapshot)), contentType: "application/json; charset=utf-8" });
    },
  };
}

let defaultStore: GeminiCarbonTimingStore | undefined;
/**
 * 进程级缺省统计。测试进程（VITEST）或 env GEMINI_CARBON_TIMING_PERSIST=0 时不持久化（只用内存），避免单测里碰 GCS。
 */
export function getDefaultGeminiCarbonTimingStore(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): GeminiCarbonTimingStore {
  if (!defaultStore) {
    const persistOff = Boolean(env.VITEST) || String(env.GEMINI_CARBON_TIMING_PERSIST ?? "").trim() === "0";
    defaultStore = new GeminiCarbonTimingStore({ persist: persistOff ? undefined : createGeminiCarbonTimingGcsPersist() });
  }
  return defaultStore;
}

/** 请求规模估算：systemInstruction 与文字 part 按字符估 token，媒体 part 按固定等效 token。 */
export function estimateGeminiCarbonRequestTokens(request: { systemInstruction?: string; parts: Array<{ text: string } | { media: unknown }> }): { inputChars: number; inputTokens: number } {
  let inputChars = (request.systemInstruction ?? "").length;
  let inputTokens = estimateGeminiCarbonTokens(request.systemInstruction ?? "");
  for (const part of request.parts) {
    if ("text" in part) { inputChars += part.text.length; inputTokens += estimateGeminiCarbonTokens(part.text); } else inputTokens += GEMINI_CARBON_MEDIA_PART_TOKENS;
  }
  return { inputChars, inputTokens };
}
