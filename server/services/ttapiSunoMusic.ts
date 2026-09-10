/**
 * TTAPI · Suno v6 音乐生成适配器（配乐间第二来源，0910 用户拍板）。
 *
 * 背景：Suno v6 于 2026-09-09 发布，EvoLink 还没上 v6，Suno 官方没有 API，
 * 自建 cookie 桥卡在验证码。TTAPI 是先上 v6 的第三方网关，
 * 与 EvoLink Suno 同属一类，用户全程不出工作流。EvoLink 上了 v6 再切回去只改模型 id。
 *
 * 端点与字段照文档 https://docs.ttapi.io/api/en/suno ：
 *   POST https://api.ttapi.io/suno/v1/music     头 `TT-API-KEY`；body { mv, prompt, tags, title, custom, instrumental, negative_tags, duration, vocal_gender, audio_format }
 *   （`duration` 10–360 秒、`vocal_gender` Male/Female 只在 OpenAPI 规格 /openapi/en/suno.json 里，网页文档漏列；0910 实测生效）
 *   GET  https://api.ttapi.io/suno/v2/fetch?jobId=…  → { status: ON_QUEUE|SUCCESS|…, data: { musics: [{ musicId, audioUrl, title, duration, imageUrl }] } }
 *   价格：每次生成 6 quota ≈ $0.06，三档同价；max_mode 翻倍（不开）。
 * - duration 是目标时长，上游按段落尽量贴近；成品仍按段表裁。
 * - 429 这里一律抛 rejected(429)；轮询方（manhuaScoringRoom）看到 429 多等一个间隔再问；建单绝不自动重发（与 EvoLink 通道同一纪律）。
 */

export const TTAPI_SUNO_MODELS = ["suno-v6-mini", "suno-v6", "suno-v6-wild"] as const;
export type TtapiSunoModel = (typeof TTAPI_SUNO_MODELS)[number];

export function isTtapiSunoModel(model: unknown): model is TtapiSunoModel {
  return (TTAPI_SUNO_MODELS as readonly string[]).includes(String(model || ""));
}

export const TTAPI_BASE = String(process.env.TTAPI_API_BASE || "https://api.ttapi.io").trim().replace(/\/+$/, "");
export const TTAPI_SUNO_SUBMIT_PATH = "/suno/v1/music";
export const TTAPI_SUNO_FETCH_PATH = "/suno/v2/fetch";

export function getTtapiKey(): string {
  return String(process.env.TTAPI_KEY || "").trim();
}

export function isTtapiSunoReady(): boolean {
  return Boolean(getTtapiKey());
}

/** TTAPI 侧模型代号；上游改名只改 env，不改代码 */
export function resolveTtapiSunoMv(model: TtapiSunoModel): string {
  if (model === "suno-v6") return String(process.env.TTAPI_SUNO_MV_V6 || "chirp-v6").trim();
  if (model === "suno-v6-wild") return String(process.env.TTAPI_SUNO_MV_V6_WILD || "chirp-v6-wild").trim();
  return String(process.env.TTAPI_SUNO_MV_V6_MINI || "chirp-v6-mini").trim();
}

export type TtapiSunoCustomRequest = {
  model: TtapiSunoModel;
  /** custom 模式下的歌词或段落结构；纯器乐由 instrumental 独立约束，不清空用户要求。 */
  prompt: string;
  /** 风格标签（Suno 的 tags） */
  style: string;
  title: string;
  instrumental: boolean;
  negative_tags?: string;
  /** 目标时长（秒），10–360；越界直接抛，不让上游静默忽略 */
  duration?: number;
  vocal_gender?: "Male" | "Female";
};

export function assertTtapiSunoRequest(req: TtapiSunoCustomRequest): void {
  if (req.duration != null && (!Number.isInteger(req.duration) || req.duration < 10 || req.duration > 360)) {
    throw new Error(`duration 必须是 10–360 的整数，收到 ${req.duration}`);
  }
  if (!String(req.style || "").trim()) throw new Error("custom 模式下 style（tags）必填");
  if (!String(req.title || "").trim()) throw new Error("custom 模式下 title 必填");
  if (!String(req.prompt || "").trim()) throw new Error("custom 模式下 prompt（歌词或段落结构）必填");
}

export type TtapiSunoMusic = {
  musicId: string;
  audioUrl?: string;
  title?: string;
  duration?: number;
  imageUrl?: string;
};

/** 不把上游响应正文或底层异常放入错误；它们可能含鉴权头。 */
export class TtapiSunoRequestError extends Error {
  constructor(
    public readonly code: "not_configured" | "rejected" | "unconfirmed" | "invalid_response",
    public readonly submissionUnknown: boolean,
    public readonly httpStatus?: number,
  ) {
    const message = submissionUnknown
      ? "配乐提交结果待核对，未自动重提，请保留本次任务"
      : httpStatus === 401 || httpStatus === 403
        ? "配乐服务认证未通过，请检查服务端 TTAPI 配置"
        : httpStatus === 429
          ? "配乐服务繁忙（限流），请稍后重试"
          : code === "not_configured"
            ? "配乐 v6 通道尚未配置（TTAPI_KEY）"
            : "配乐服务返回异常，请检查本次任务状态";
    super(message);
    this.name = "TtapiSunoRequestError";
  }
}

export function isTtapiSunoSubmissionUnknown(error: unknown): boolean {
  return error instanceof TtapiSunoRequestError && error.submissionUnknown;
}

/** 任务号前缀区分来源，与 EvoLink 的 task id 不混 */
export const TTAPI_SUNO_TASK_PREFIX = "ttapi:";

const JOB_ID_RE = /^[0-9A-Za-z_-]{6,128}$/;
/** 上游明确终态失败的 status 值（fetch 与 submit 都用） */
const TERMINAL_FAILED = new Set(["FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED", "TIMEOUT"]);

export function encodeTtapiSunoTaskId(jobId: string): string {
  const id = String(jobId || "").trim();
  if (!JOB_ID_RE.test(id)) throw new TtapiSunoRequestError("invalid_response", true);
  return `${TTAPI_SUNO_TASK_PREFIX}${id}`;
}

export function decodeTtapiSunoTaskId(taskId: string): string | null {
  const raw = String(taskId || "");
  if (!raw.startsWith(TTAPI_SUNO_TASK_PREFIX)) return null;
  const id = raw.slice(TTAPI_SUNO_TASK_PREFIX.length);
  return JOB_ID_RE.test(id) ? id : null;
}

async function ttapiFetch(path: string, init: { method?: "GET" | "POST"; body?: string; abortSignal?: AbortSignal }): Promise<unknown> {
  const key = getTtapiKey();
  if (!key) throw new TtapiSunoRequestError("not_configured", false);
  const submitting = init.method === "POST";
  if (init.abortSignal?.aborted) throw new TtapiSunoRequestError("rejected", false);
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${TTAPI_BASE}${path}`, {
      method: init.method || "GET",
      headers: { "Content-Type": "application/json", "TT-API-KEY": key },
      body: init.body,
      signal: init.abortSignal,
      redirect: "error",
    });
    text = await res.text();
  } catch {
    // POST 可能已被上游接受，断线/读取响应失败不能解释为没有建单。
    throw new TtapiSunoRequestError("unconfirmed", submitting);
  }
  if (!res.ok) {
    // 网关超时/服务端错误可能发生在上游建单之后，保守转对账；4xx（含 429）是明确拒绝。
    throw new TtapiSunoRequestError("rejected", submitting && (res.status >= 500 || res.status === 408), res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TtapiSunoRequestError("invalid_response", submitting, res.status);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickMusics(raw: unknown): TtapiSunoMusic[] {
  const data = asRecord(asRecord(raw)?.data);
  const list = Array.isArray(data?.musics) ? (data!.musics as unknown[]) : [];
  return list
    .map(asRecord)
    .filter((m): m is Record<string, unknown> => Boolean(m))
    .map((m) => ({
      musicId: String(m.musicId || m.id || "").trim(),
      audioUrl: String(m.audioUrl || m.audio_url || "").trim() || undefined,
      title: String(m.title || "").trim() || undefined,
      duration: Number.isFinite(Number(m.duration)) ? Number(m.duration) : undefined,
      imageUrl: String(m.imageUrl || m.image_url || "").trim() || undefined,
    }))
    .filter((m) => m.musicId);
}

function isHttpsUrl(v: string | undefined): v is string {
  if (!v) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** 只发一次 POST；调用方拿到 task id 后必须先持久化（与 EvoLink 通道同一纪律） */
export async function createTtapiSunoTask(
  req: TtapiSunoCustomRequest,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<{ taskId: string; jobId: string; mv: string }> {
  assertTtapiSunoRequest(req);
  const mv = resolveTtapiSunoMv(req.model);
  const raw = await ttapiFetch(TTAPI_SUNO_SUBMIT_PATH, {
    method: "POST",
    body: JSON.stringify({
      mv,
      prompt: req.prompt,
      tags: req.style,
      title: req.title.slice(0, 80),
      custom: true,
      instrumental: Boolean(req.instrumental),
      negative_tags: req.negative_tags || "",
      ...(req.duration != null ? { duration: req.duration } : {}),
      ...(req.vocal_gender ? { vocal_gender: req.vocal_gender } : {}),
      audio_format: "mp3",
    }),
    abortSignal: opts.abortSignal,
  });
  const root = asRecord(raw);
  const jobId = String(asRecord(root?.data)?.jobId || "").trim();
  const status = String(root?.status || "").toUpperCase();
  if (TERMINAL_FAILED.has(status) && !jobId) {
    // 200 + FAILED 且没有 jobId：上游明确拒单（配额不足/参数拒绝），没建单 → 明确拒绝，可退款
    throw new TtapiSunoRequestError("rejected", false, 200);
  }
  if (status !== "SUCCESS" || !JOB_ID_RE.test(jobId)) {
    // 200 但状态不明或 jobId 缺/坏：上游可能已建单也可能没有，按未知对账
    throw new TtapiSunoRequestError("invalid_response", true);
  }
  return { taskId: encodeTtapiSunoTaskId(jobId), jobId, mv };
}

export type TtapiSunoTaskState =
  | { status: "pending"; progress: number; musics: TtapiSunoMusic[] }
  | { status: "completed"; musics: TtapiSunoMusic[]; audioUrls: string[]; missing: number }
  | { status: "failed"; musics: TtapiSunoMusic[]; reason: string };

/** Suno 一次生成惯例出两首；TTAPI 文档示例只列一首，少于两首记 missing，不把已出的丢掉 */
export const TTAPI_SUNO_EXPECTED_VARIANTS = 2;

export async function getTtapiSunoTask(taskId: string, opts: { abortSignal?: AbortSignal } = {}): Promise<TtapiSunoTaskState> {
  const jobId = decodeTtapiSunoTaskId(taskId);
  if (!jobId) throw new Error("不是 TTAPI 配乐的任务号");
  const raw = await ttapiFetch(`${TTAPI_SUNO_FETCH_PATH}?jobId=${encodeURIComponent(jobId)}`, { abortSignal: opts.abortSignal });
  const root = asRecord(raw);
  const status = String(root?.status || "").toUpperCase();
  const musics = pickMusics(raw);
  const progressRaw = String(asRecord(root?.data)?.progress ?? "").replace("%", "");
  const progress = Math.max(0, Math.min(100, Math.floor(Number(progressRaw) || 0)));
  if (status === "SUCCESS") {
    const audioUrls = Array.from(new Set(musics.map((m) => m.audioUrl).filter(isHttpsUrl)));
    if (!audioUrls.length) {
      return { status: "failed", musics, reason: "配乐生成完成但没有音频地址，请保留原任务供服务端核对" };
    }
    return { status: "completed", musics, audioUrls, missing: Math.max(0, TTAPI_SUNO_EXPECTED_VARIANTS - audioUrls.length) };
  }
  if (TERMINAL_FAILED.has(status)) {
    return { status: "failed", musics, reason: "配乐生成未成功，请保留原任务供服务端核对" };
  }
  return { status: "pending", progress, musics };
}
