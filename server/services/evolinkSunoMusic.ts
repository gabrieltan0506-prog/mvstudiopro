/**
 * EvoLink · Suno 音乐生成适配器（配乐间上游）。
 *
 * 端点与约束全部照 EvoLink 文档，不凭记忆：
 *   POST https://api.evolink.ai/v1/audios/generations
 *   GET  https://api.evolink.ai/v1/tasks/{id}
 *   计费 per_call · 预留 10 credits · **产物 72 小时过期**
 *
 * ⚠️ 文档里最容易踩的一条，也是现有 `server/models/suno.ts` 踩中的那条：
 *
 * > `duration` 只在 `model=suno-v5.5-beta` **且** `custom_mode=true` 时可用，
 * > 10–360 整数；省略则上游默认 **20 秒**。
 * > simple mode（custom_mode=false）下 style / title / negative_tags /
 * > vocal_gender / style_weight / persona_* / duration 全部
 * > 「have no effect whatsoever」——**不报错，就是不生效**。
 *
 * 现有实现是 `custom_mode: false` 且把「生成32秒纯音乐」写在提示词里，
 * 所以时长根本没生效。本模块把这条约束写成断言，传错直接抛，
 * 不让它再变成「跑完了才发现是 20 秒」。
 */

export const EVOLINK_AUDIO_BASE = String(
  process.env.EVOLINK_API_BASE || "https://api.evolink.ai",
).replace(/\/$/, "");

export const EVOLINK_SUNO_GENERATION_PATH = "/v1/audios/generations";
export const EVOLINK_TASK_PATH = "/v1/tasks";

/** 只允许 V5.5：其它版本没有 duration，配乐间的段表对不齐就没意义 */
export const EVOLINK_SUNO_MODEL = "suno-v5.5-beta" as const;

export function isEvolinkSunoReady(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

export type EvolinkSunoRequest = {
  model: typeof EVOLINK_SUNO_MODEL;
  custom_mode: boolean;
  instrumental: boolean;
  style?: string;
  title?: string;
  prompt?: string;
  duration?: number;
  negative_tags?: string;
  /** 要它听话就往上：0.75–0.82 */
  style_weight?: number;
  /** 配乐要托底不抢戏：0.2–0.3 */
  weirdness_constraint?: number;
};

/**
 * 参数组合硬校验：**在发出请求之前**。
 *
 * 这些组合传错不会报错，只会静默不生效或整单参数错误，
 * 而异步任务要等轮询才知道失败 —— 钱和时间都白花。
 */
export function assertEvolinkSunoRequest(req: EvolinkSunoRequest): void {
  if (req.model !== EVOLINK_SUNO_MODEL) {
    throw new Error(`配乐只走 ${EVOLINK_SUNO_MODEL}：其它版本没有 duration`);
  }
  if (req.duration != null) {
    if (!req.custom_mode) {
      throw new Error("duration 只在 custom_mode=true 时生效，simple mode 下传了也没用");
    }
    if (!Number.isInteger(req.duration) || req.duration < 10 || req.duration > 360) {
      throw new Error(`duration 必须是 10–360 的整数，收到 ${req.duration}`);
    }
  }
  if (req.custom_mode) {
    if (!String(req.style || "").trim()) throw new Error("custom_mode 下 style 必填");
    if (!String(req.title || "").trim()) throw new Error("custom_mode 下 title 必填");
    // instrumental=false 时 prompt 当精准歌词用，必填
    if (!req.instrumental && !String(req.prompt || "").trim()) {
      throw new Error("custom_mode 且要人声时，prompt 作为歌词必填");
    }
  } else {
    // simple mode 下这些字段全部无效，带上只会让人以为生效了
    for (const k of ["style", "title", "negative_tags", "duration"] as const) {
      if (req[k] != null && String(req[k]).trim() !== "") {
        throw new Error(`simple mode 下 ${k} 不生效，请改用 custom_mode=true`);
      }
    }
    if (!String(req.prompt || "").trim()) throw new Error("simple mode 下 prompt 必填");
  }
}

export type EvolinkSunoTask = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  model: string;
};

/** 建任务。**这一步开始计费**，调用方必须已经过发车检查单 */
export async function createEvolinkSunoTask(
  req: EvolinkSunoRequest,
  opts: { apiKey?: string; abortSignal?: AbortSignal } = {},
): Promise<EvolinkSunoTask> {
  assertEvolinkSunoRequest(req);
  const apiKey = String(opts.apiKey || process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error("配乐缺少 EVOLINK_API_KEY");

  const res = await fetch(`${EVOLINK_AUDIO_BASE}${EVOLINK_SUNO_GENERATION_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: opts.abortSignal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`evolink_suno_create_failed:${res.status}:${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as Partial<EvolinkSunoTask>;
  const id = String(json.id || "").trim();
  if (!id) throw new Error("配乐建单成功但未返回 task id");
  return {
    id,
    status: (json.status as EvolinkSunoTask["status"]) || "pending",
    progress: Math.max(0, Math.min(100, Math.floor(Number(json.progress) || 0))),
    model: String(json.model || req.model),
  };
}

export async function getEvolinkSunoTask(
  taskId: string,
  opts: { apiKey?: string; abortSignal?: AbortSignal } = {},
): Promise<{ task: EvolinkSunoTask; raw: unknown }> {
  const apiKey = String(opts.apiKey || process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error("配乐缺少 EVOLINK_API_KEY");
  const res = await fetch(
    `${EVOLINK_AUDIO_BASE}${EVOLINK_TASK_PATH}/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` }, signal: opts.abortSignal },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`evolink_task_failed:${res.status}:${text.slice(0, 300)}`);
  const raw = JSON.parse(text) as Partial<EvolinkSunoTask>;
  return {
    task: {
      id: String(raw.id || taskId),
      status: (raw.status as EvolinkSunoTask["status"]) || "pending",
      progress: Math.max(0, Math.min(100, Math.floor(Number(raw.progress) || 0))),
      model: String(raw.model || ""),
    },
    raw,
  };
}

/**
 * 从任务详情里挑音频地址。
 *
 * 一次请求会返回**多个变体**（文档："Each request generates multiple music
 * variations"），全部返回交由调用方选，不擅自只取第一条。
 */
/**
 * 从任务详情里挑音频地址。
 *
 * 两轮都栽在这个函数上，教训相反：
 *   第一版按「键名或 URL 含 audio」模糊匹配 → `audio_image_url` 的封面 jpg
 *     被当成音频，还排在真音频前面（已复现）
 *   第二版收紧成「明确字段名 ＋ 音频扩展名」→ 又把 `results[]` 字符串数组
 *     和**无扩展名的签名下载链**全丢了（也已复现）
 *
 * 现在按**可信结构**读，不靠 URL 长相猜：只从上游文档给的位置取值，
 * 取到什么算什么；是不是真音频交给下载阶段用 Content-Type ＋ ffprobe 验。
 * 封面之所以不会混进来，是因为 `audio_image_url` 根本不在取值位置里。
 */
export function pickEvolinkSunoAudioUrls(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const root = raw as Record<string, unknown>;
  const candidates: unknown[] = [];

  const pushFrom = (node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const o = node as Record<string, unknown>;
    candidates.push(o.audio_url, o.audioUrl, o.download_url, o.stream_url);
  };

  const resultData = root.result_data;
  if (Array.isArray(resultData)) {
    for (const item of resultData) pushFrom(item);
  } else if (resultData && typeof resultData === "object") {
    const data = resultData as Record<string, unknown>;
    pushFrom(data);
    if (Array.isArray(data.clips)) for (const clip of data.clips) pushFrom(clip);
  }
  if (Array.isArray(root.clips)) for (const clip of root.clips) pushFrom(clip);
  if (Array.isArray(root.results)) candidates.push(...root.results);
  pushFrom(root);

  return Array.from(
    new Set(
      candidates
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => {
          try {
            return new URL(v).protocol === "https:";
          } catch {
            return false;
          }
        }),
    ),
  );
}

/**
 * 产物 72 小时过期。
 *
 * 返回的 URL 只能当**临时取件码**：必须即取即转 GCS，
 * 否则三天后曲库里全是死链，而曲库是会被反复引用的。
 */
export const EVOLINK_SUNO_ASSET_TTL_HOURS = 72;

