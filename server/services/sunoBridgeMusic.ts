/**
 * Suno cookie 桥（内部专用）客户端。桥 = infra/suno-bridge（gcui-art/suno-api），只走 Fly 6PN。
 *
 * 与 EvoLink 通道并列的第二来源：用户 0910 拍板走 cookie 桥出 v6（选项 3）。
 * - 桥接口：POST /api/custom_generate → 两条 clip；GET /api/get?ids=… 轮询到 complete 取 audio_url。
 * - 模型代号从已登录网页 React 状态读到：v6-mini = chirp-goose，v6（preview）= chirp-hawk；对不上时用环境变量改。
 * - 无 duration 参数（网页 v2 接口没有）；整曲生成后仍按段表裁。
 * - 违反 Suno 条款、会封号：只给 admin/supervisor 用，普通用户看不到这个来源。
 */

export const SUNO_BRIDGE_MODELS = ["suno-bridge-v6-mini", "suno-bridge-v6"] as const;
export type SunoBridgeModel = (typeof SUNO_BRIDGE_MODELS)[number];

export function isSunoBridgeModel(model: unknown): model is SunoBridgeModel {
  return (SUNO_BRIDGE_MODELS as readonly string[]).includes(String(model || ""));
}

export function sunoBridgeBaseUrl(): string {
  return String(process.env.SUNO_BRIDGE_URL || "").trim().replace(/\/+$/, "");
}

export function isSunoBridgeReady(): boolean {
  return /^https?:\/\//i.test(sunoBridgeBaseUrl());
}

/** 网页内部代号；页面改版后只改 env，不改代码 */
export function resolveSunoBridgeChirpModel(model: SunoBridgeModel): string {
  if (model === "suno-bridge-v6") return String(process.env.SUNO_BRIDGE_MODEL_V6 || "chirp-hawk").trim();
  return String(process.env.SUNO_BRIDGE_MODEL_V6_MINI || "chirp-goose").trim();
}

export type SunoBridgeCustomRequest = {
  model: SunoBridgeModel;
  /** custom_mode 下的歌词；纯 BGM 传空串 */
  prompt: string;
  /** 风格标签（Suno 的 tags） */
  style: string;
  title: string;
  instrumental: boolean;
  negative_tags?: string;
};

export type SunoBridgeClip = {
  id: string;
  status: string;
  audio_url?: string;
  title?: string;
  model_name?: string;
  duration?: number;
  error_message?: string;
};

/** 桥的任务号：两条 clip id 用逗号拼，前缀区分来源，与 EvoLink 的 task id 不混 */
export const SUNO_BRIDGE_TASK_PREFIX = "sunobridge:";

export function encodeSunoBridgeTaskId(clipIds: string[]): string {
  return `${SUNO_BRIDGE_TASK_PREFIX}${clipIds.join(",")}`;
}

export function decodeSunoBridgeTaskId(taskId: string): string[] | null {
  const raw = String(taskId || "");
  if (!raw.startsWith(SUNO_BRIDGE_TASK_PREFIX)) return null;
  const ids = raw.slice(SUNO_BRIDGE_TASK_PREFIX.length).split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{8,64}$/i.test(s));
  return ids.length ? ids : null;
}

async function bridgeFetch(path: string, init: RequestInit & { abortSignal?: AbortSignal }): Promise<unknown> {
  const base = sunoBridgeBaseUrl();
  if (!base) throw new Error("配乐直连未配置：缺 SUNO_BRIDGE_URL");
  const res = await fetch(`${base}${path}`, {
    method: init.method || "GET",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    body: init.body,
    signal: init.abortSignal,
  });
  const text = await res.text();
  if (!res.ok) {
    // cookie 过期/被封在桥里表现为 401/403/5xx；文案让运维知道去换 cookie
    const hint = res.status === 401 || res.status === 403 ? "（多半是 Suno cookie 过期或账号受限，换 cookie 后重设 secret）" : "";
    throw new Error(`suno_bridge_failed:${res.status}:${text.slice(0, 300)}${hint}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`suno_bridge_bad_json:${text.slice(0, 200)}`);
  }
}

function pickClips(raw: unknown): SunoBridgeClip[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { clips?: unknown })?.clips) ? ((raw as { clips: unknown[] }).clips) : [];
  return list
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : null))
    .filter((c): c is Record<string, unknown> => Boolean(c))
    .map((c) => ({
      id: String(c.id || "").trim(),
      status: String(c.status || "").trim().toLowerCase(),
      audio_url: String(c.audio_url || "").trim() || undefined,
      title: String(c.title || "").trim() || undefined,
      model_name: String(c.model_name || "").trim() || undefined,
      duration: Number.isFinite(Number(c.duration)) ? Number(c.duration) : undefined,
      error_message: String(c.error_message || "").trim() || undefined,
    }))
    .filter((c) => c.id);
}

/** 只发一次 POST；调用方拿到 task id 后必须先持久化（与 EvoLink 通道同一纪律） */
export async function createSunoBridgeTask(
  req: SunoBridgeCustomRequest,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<{ taskId: string; clipIds: string[]; chirpModel: string }> {
  const chirpModel = resolveSunoBridgeChirpModel(req.model);
  const raw = await bridgeFetch("/api/custom_generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: req.instrumental ? "" : req.prompt,
      tags: req.style,
      title: req.title.slice(0, 80),
      make_instrumental: Boolean(req.instrumental),
      model: chirpModel,
      wait_audio: false,
      negative_tags: req.negative_tags || "",
    }),
    abortSignal: opts.abortSignal,
  });
  const clips = pickClips(raw);
  if (!clips.length) throw new Error("配乐直连建单成功但桥没有返回 clip");
  const clipIds = clips.map((c) => c.id);
  return { taskId: encodeSunoBridgeTaskId(clipIds), clipIds, chirpModel };
}

export type SunoBridgeTaskState =
  | { status: "pending"; clips: SunoBridgeClip[] }
  | { status: "completed"; clips: SunoBridgeClip[]; audioUrls: string[] }
  | { status: "failed"; clips: SunoBridgeClip[]; reason: string };

/** 两条 clip 全 complete 才算完成；任一 error 即失败（不半成品入库） */
export async function getSunoBridgeTask(taskId: string, opts: { abortSignal?: AbortSignal } = {}): Promise<SunoBridgeTaskState> {
  const ids = decodeSunoBridgeTaskId(taskId);
  if (!ids) throw new Error("不是配乐直连的任务号");
  const raw = await bridgeFetch(`/api/get?ids=${encodeURIComponent(ids.join(","))}`, { abortSignal: opts.abortSignal });
  const clips = pickClips(raw).filter((c) => ids.includes(c.id));
  const failed = clips.find((c) => c.status === "error");
  if (failed) return { status: "failed", clips, reason: failed.error_message || "Suno 返回 error" };
  const done = clips.filter((c) => c.status === "complete" && c.audio_url);
  if (clips.length === ids.length && done.length === ids.length) {
    return { status: "completed", clips, audioUrls: ids.map((id) => done.find((c) => c.id === id)!.audio_url!) };
  }
  return { status: "pending", clips };
}
