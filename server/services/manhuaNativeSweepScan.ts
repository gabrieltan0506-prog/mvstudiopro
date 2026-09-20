/**
 * 整形前补扫（GLM-5.3 Flash 读分片视频）。
 *
 * 用户 0920 原话：
 *   「GLM5.3 flash整形之前，先讓他讀一遍所有的分片，Ｇemini 判定是keymonents的必須保留，
 *     他也可以判斷哪些是有亮點跟特色的鏡頭，值得列入模板的，這些鏡頭不得含有廣告跟宣傳商品，
 *     必須是與劇情相關的鏡頭才行。」
 *   「**ＧＬＭ5.3 flash可以讀視頻，但沒有辦法讀音頻**，所以我才只讓他看畫面跟字幕。」
 *
 * 🔑 通道：走 GLM 两档的**双路并发**（与整形同口径），不钉单路。
 *
 * 0920 实测 + 用户订正，两条都要记着：
 *   · EvoLink `glm-5.3-flash` 喂 15 秒 mp4（data-url）**不报错**：HTTP 200 / 22.7s，答对画面内容。
 *   · 但它的 reasoning_content 自招「提供了 **11 张视频截图**」并逐秒列点 —— 即 **1 秒 1 帧抽帧**。
 *   · 用户订正：**OpenRouter 侧同样是抽帧**，Qwen3.8 也是；
 *     **只有 Gemini 3.1 Pro 与 Gemini 3.8 Flash 才真读视频与音频**。
 *   · 🔑 **判据（用户给的，0920 实查成立）：看 `input_modalities` 里有没有 `audio`。**
 *     能同时读音频的才是真读视频；只有 `video` 没 `audio` ＝ 抽帧。实查：
 *       google/gemini-3.1-pro-preview  ["audio","file","image","text","video"]  ✅ 真读
 *       google/gemini-3.8-flash        ["text","image","video","file","audio"]  ✅ 真读
 *       z-ai/glm-5.3-flash             ["text","image","video"]                 ❌ 抽帧
 *       qwen/qwen3.8-max-0902          ["text","image","video"]                 ❌ 抽帧
 *       z-ai/glm-5.3                   ["text"]                                 纯文本
 *   → 两档口径一致（都抽帧），所以补扫可以照常双路并发；
 *     也正因为是抽帧，帧间差分（运镜/力度/切点手感）本就抓不到，
 *     补扫只负责「哪一秒有亮点、画面是什么、字幕写什么」。
 * 🔒 仍用 `glm_only`：不落 Qwen（用户 0920「把qwen都拿掉…不用qwen 3.8」）。
 *
 * 本模块只负责「扫 + 解析」；合并判据全在 shared/manhuaNativeSweepMerge.ts（纯函数、可单测）。
 */
import { invokeGlmJsonChatWithGatewayFallback } from "./bailianChat.js";
import { signGsUriV4ReadUrl } from "./gcs.js";
import { extractSweepFrames, SWEEP_MAX_FRAMES_PER_SEGMENT } from "./manhuaNativeSweepFrames.js";
import {
  mergeManhuaNativeSweepCandidates,
  type ManhuaNativeSweepCandidate,
  type ManhuaNativeSweepMergeResult,
} from "../../shared/manhuaNativeSweepMerge.js";

/** 补扫每片的输出上限：只补漏，不重写整段，不必给大预算。 */
export const MANHUA_SWEEP_MAX_TOKENS = 16_384;
/** 补扫思考档：这是「挑漏」不是开放推理，low 足够且便宜。 */
export const MANHUA_SWEEP_REASONING_EFFORT = "low" as const;
/** 单片最多补进来的条数；防止模型把整段重写一遍当补扫。 */
export const MANHUA_SWEEP_MAX_ADDED_PER_SEGMENT = 12;

export type ManhuaNativeSweepSegmentInput = {
  /** 用于帧对象命名，落 GCS 时按剧/集/片分目录。 */
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
  /** 分片媒体的 gs:// 地址；由本模块签成短期 https 给模型读。 */
  gsUri: string;
  startSec: number;
  endSec: number;
  /** Gemini 已列出的 keyMoments（绝对秒）。**必须保留，一条都不删。** */
  geminiKeyMoments: ReadonlyArray<{ atSec: number; kindZh: string; noteZh: string }>;
  /** 本片字幕（绝对秒），随提示词给模型当文字线索。 */
  subtitles: ReadonlyArray<{ atSec: number; textZh: string }>;
  /** 剧情镜区间（绝对秒）；候选必须落在其中才算「与剧情相关」。 */
  storyRanges: ReadonlyArray<{ startSec: number; endSec: number }>;
  /** 广告区间（绝对秒）。 */
  excludedAdRanges?: ReadonlyArray<{ startSec: number; endSec: number }>;
};

export type ManhuaNativeSweepSegmentResult = {
  segmentIndex: number;
  merge: ManhuaNativeSweepMergeResult;
  /** 本片是否真的发出了补扫调用（通道不可用 / 无 gsUri 时为 false）。 */
  scanned: boolean;
  skippedReasonZh?: string;
  /** 本片实际喂给模型的帧数（0 ＝ 没抽到，退回整片直送）。 */
  frameCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

function buildSweepPrompt(input: ManhuaNativeSweepSegmentInput): { system: string; user: string } {
  const known = input.geminiKeyMoments
    .map((m) => `${Math.round(m.atSec * 10) / 10}s【${m.kindZh}】${m.noteZh}`)
    .join("\n") || "（本片上一轮没有列出任何重点时刻）";
  const subs = input.subtitles.slice(0, 400)
    .map((s) => `${Math.round(s.atSec)}s ${s.textZh}`).join("\n") || "（本片无字幕）";
  return {
    system: [
      "你在给一部片子做「补漏」：上一轮已有一份重点时刻表，你的唯一任务是**找出它漏掉的、真正精彩或有特色的画面**。",
      "硬规矩：",
      "1. 已列出的重点时刻**一条都不要重复、不要改写、不要删除**——它们不归你管。",
      "2. 只补你**在所附截图里亲眼看到**的。看不清、拿不准的不要写。",
      "   每张截图前面都标了它的**全片绝对秒**，`atSec` 直接写那个秒位，不要自己推算。",
      "3. 补进来的每一条都要说得出**精彩在哪**（哪一刀、哪个光、哪个表情、哪个调度），",
      "   写不出具体理由的一律不要补。通用词（剧情推进、气氛紧张）不算理由。",
      "4. **禁止补广告或商品宣传内容**；必须是**与剧情相关**的镜头。",
      "5. 你**听不到声音**，不要对声音、配乐、音效做任何判断，也不要补音轨类。",
      `6. 最多补 ${MANHUA_SWEEP_MAX_ADDED_PER_SEGMENT} 条。宁可少补，不要凑数。`,
      "",
      "只返回一个 JSON，不要 Markdown 围栏：",
      '{"candidates":[{"atSec":全片绝对秒(数字),"kindZh":"切镜|情绪|灯光|剧情","noteZh":"精彩在哪","subtitleZh":"该秒可见字幕(没有就省略)"}]}',
      "kindZh 只能是 切镜 / 情绪 / 灯光 / 剧情 四类之一（音轨类不接受，你听不到声音）。",
    ].join("\n"),
    user: [
      `本片覆盖全片绝对秒 ${Math.round(input.startSec)}–${Math.round(input.endSec)} 秒。`,
      "下面按时间顺序给出本片截图，每张前面标着它的全片绝对秒。",
      "",
      "【上一轮已列出的重点时刻（不要重复、不要改动）】",
      known,
      "",
      "【本片字幕】",
      subs,
    ].join("\n"),
  };
}

function parseSweepCandidates(raw: unknown): ManhuaNativeSweepCandidate[] {
  const rows = (raw as { candidates?: unknown })?.candidates;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MANHUA_SWEEP_MAX_ADDED_PER_SEGMENT * 3).flatMap((row) => {
    const r = row as Record<string, unknown>;
    const atSec = Number(r?.atSec);
    if (!Number.isFinite(atSec)) return [];
    const out: ManhuaNativeSweepCandidate = {
      atSec,
      kindZh: String(r?.kindZh || "").trim(),
      noteZh: String(r?.noteZh || "").trim(),
    };
    const sub = String(r?.subtitleZh || "").trim();
    if (sub) out.subtitleZh = sub;
    return [out];
  });
}

export type ManhuaNativeSweepDeps = {
  invoke?: typeof invokeGlmJsonChatWithGatewayFallback;
  signUrl?: typeof signGsUriV4ReadUrl;
};

/**
 * 扫一片。任何失败都**不抛**：补扫是增益步骤，不该有弄死整集付费产出的杀伤力——
 * 失败时按「没补到东西」返回，Gemini 原稿逐条原样保留。
 */
export async function sweepOneSegmentBeforeStructuring(
  input: ManhuaNativeSweepSegmentInput,
  abortSignal?: AbortSignal,
  deps: ManhuaNativeSweepDeps = {},
): Promise<ManhuaNativeSweepSegmentResult> {
  const invoke = deps.invoke ?? invokeGlmJsonChatWithGatewayFallback;
  const sign = deps.signUrl ?? signGsUriV4ReadUrl;
  const passthrough = (reasonZh?: string): ManhuaNativeSweepSegmentResult => ({
    segmentIndex: input.segmentIndex,
    merge: mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: input.geminiKeyMoments, candidates: [],
      storyRanges: input.storyRanges, excludedAdRanges: input.excludedAdRanges,
    }),
    scanned: false,
    ...(reasonZh ? { skippedReasonZh: reasonZh } : {}),
  });
  if (!String(input.gsUri || "").trim()) return passthrough("本片没有可读的媒体地址");
  if (!String(process.env.OPENROUTER_API_KEY || "").trim()
    && !String(process.env.EVOLINK_API_KEY || "").trim()) {
    return passthrough("补扫通道不可用：GLM 两档的钥匙都没配");
  }

  let videoUrl: string;
  try {
    videoUrl = sign(input.gsUri, 2 * 3600);
  } catch (error) {
    return passthrough(`签名分片地址失败：${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * 🔑 0920 用户拍板「改」：自己用 ffmpeg 按信号抽帧，不再整片丢给厂商均匀抽。
   * 抽不到帧（ffmpeg 不可用 / 信号探测全空 / 上传失败）时**退回整片直送**，
   * 不让补扫整条断掉——它是增益步骤。
   */
  let frames: Awaited<ReturnType<typeof extractSweepFrames>> = [];
  try {
    frames = await extractSweepFrames({
      seriesKey: input.seriesKey,
      episodeIndex: input.episodeIndex,
      segmentIndex: input.segmentIndex,
      mediaUrl: videoUrl,
      segmentStartSec: input.startSec,
      lenSec: Math.max(1, input.endSec - input.startSec),
      maxFrames: SWEEP_MAX_FRAMES_PER_SEGMENT,
      abortSignal,
    });
  } catch {
    frames = [];
  }

  const prompt = buildSweepPrompt(input);
  try {
    const answer = await invoke({
      ...prompt,
      // 有帧就送帧（每张带全片绝对秒标签）；一帧都没抽到才退回整片直送。
      ...(frames.length
        ? { imageParts: frames.map((f) => ({ url: f.url, labelZh: `【全片第 ${f.atSecAbsolute} 秒】` })) }
        : { videoUrls: [videoUrl] }),
      // GLM 两档都吃（双路并发照旧）；glm_only 保证不落 Qwen。
      gatewayPolicy: "glm_only",
      maxTokens: MANHUA_SWEEP_MAX_TOKENS,
      reasoningEffort: MANHUA_SWEEP_REASONING_EFFORT,
      abortSignal,
    } as Parameters<typeof invokeGlmJsonChatWithGatewayFallback>[0]);
    // GlmChatSuccess 继承 BailianChatResponse：正文在 choices[0].message.content（JSON 字符串）。
    let parsedAnswer: unknown = null;
    try {
      const content = answer.choices?.[0]?.message?.content;
      parsedAnswer = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return passthrough("补扫产出不是合法 JSON，本片跳过补扫");
    }
    const candidates = parseSweepCandidates(parsedAnswer).slice(0, MANHUA_SWEEP_MAX_ADDED_PER_SEGMENT * 3);
    const merge = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: input.geminiKeyMoments,
      candidates,
      storyRanges: input.storyRanges,
      excludedAdRanges: input.excludedAdRanges,
    });
    // 上限只截「补进来的」，Gemini 原条目不受影响。
    if (merge.addedCount > MANHUA_SWEEP_MAX_ADDED_PER_SEGMENT) {
      const kept = new Set<number>();
      const trimmed = merge.keyMoments.filter((m) => {
        if (!m.fromSweep) return true;
        if (kept.size >= MANHUA_SWEEP_MAX_ADDED_PER_SEGMENT) return false;
        kept.add(m.atSec);
        return true;
      });
      merge.keyMoments = trimmed;
      merge.addedCount = kept.size;
    }
    return {
      segmentIndex: input.segmentIndex,
      merge,
      scanned: true,
      frameCount: frames.length,
      inputTokens: answer.usage?.prompt_tokens,
      outputTokens: answer.usage?.completion_tokens,
      costUsd: answer.usage?.cost,
    };
  } catch (error) {
    return passthrough(`补扫调用失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
