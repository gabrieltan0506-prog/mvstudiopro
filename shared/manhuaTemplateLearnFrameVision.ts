/**
 * 漫剧节奏模板 · 关键帧视觉分析（内部学习链路）。
 * 模型：GPT-5.6 Terra · reasoning=high（经 Fly invokeLLM）。
 * 产物只填提案字段，status 仍为 proposed，须人审批准进库。
 * 成稿禁止外部剧名/抄台词画面；本模块输出亦须中性结构。
 */

import {
  MANHUA_VIRAL_TEMPLATE_LANE_ORDER,
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateBeat,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "./manhuaViralTemplateBank.js";

export const MANHUA_TEMPLATE_FRAME_VISION_MODEL = "gpt-5.6-terra" as const;
export const MANHUA_TEMPLATE_FRAME_VISION_REASONING = "high" as const;
/** 单次读帧上限（控制请求体与上下文） */
export const MANHUA_TEMPLATE_FRAME_VISION_MAX_FRAMES = 24;

export type ManhuaTemplateFrameVisionInputFrame = {
  atSec: number;
  /** data URL；服务端也可先下成 base64 */
  dataUrl?: string;
  /** 可拉取的 https */
  url?: string;
  gcsUri?: string;
  mimeType?: string;
};

export type ManhuaTemplateFrameVisionResult = {
  model: string;
  reasoningEffort: typeof MANHUA_TEMPLATE_FRAME_VISION_REASONING;
  nameZh: string;
  laneZh: ManhuaViralTemplateLane;
  summaryZh: string;
  hook3sZh: string;
  beatGrid: ManhuaViralTemplateBeat[];
  scenePoolHints: string[];
  castShape: {
    leadDesireZh: string;
    pressureZh: string;
    foilZh?: string;
  };
  /** 可选：逐帧客观描述（内部研究，不进成稿） */
  frameNotes?: Array<{ atSec: number; whatShows: string }>;
};

const LANE_SET = new Set<string>(MANHUA_VIRAL_TEMPLATE_LANE_ORDER);

export function buildManhuaTemplateFrameVisionSystemPrompt(): string {
  return `你是漫剧短视频「节奏骨架」分析员。根据按时间顺序给出的关键帧，提炼可复用的中性结构模板字段。

硬规则：
1. 只写可见冲突、信息增量、可拍动作；禁止写出外部/竞品剧名、平台片名、原台词原文、商标。
2. 禁止「仿写某某」「致敬某某」；手法只用中性标签（如 身份打脸、系统面板、开荒翻盘）。
3. hook3sZh 必须对应前约 5 秒可见钩子。
4. beatGrid 覆盖全片节奏（约每 10–15 秒一个节拍，高潮处可更密），atSec 用整数秒。
5. laneZh 必须是下列之一：${MANHUA_VIRAL_TEMPLATE_LANE_ORDER.join("、")}。
6. 只返回一个 JSON 对象，不要 Markdown 围栏或解释。

JSON 形状：
{
  "nameZh": "短名≤16字，中性",
  "laneZh": "赛道",
  "summaryZh": "一句用途≤80字",
  "hook3sZh": "前3秒可见冲突钩子",
  "beatGrid": [{"atSec":0,"conflictZh":"冲突类型","visualZh":"可拍动作"}],
  "scenePoolHints": ["场景关键词"],
  "castShape": {"leadDesireZh":"","pressureZh":"","foilZh":""},
  "frameNotes": [{"atSec":0,"whatShows":"客观画面一句"}]
}`;
}

export function buildManhuaTemplateFrameVisionUserText(input: {
  titleHint?: string;
  durationSec?: number;
  transcriptPreview?: string;
  climaxNotes?: string[];
  frames: Array<{ atSec: number }>;
}): string {
  const lines = [
    `标题线索（仅供题材猜测，勿写入成稿剧名）：${String(input.titleHint || "").trim() || "无"}`,
    `时长秒：${Number.isFinite(input.durationSec) ? Number(input.durationSec).toFixed(1) : "未知"}`,
    `关键帧秒点：${input.frames.map((f) => f.atSec.toFixed(1)).join("、")}`,
  ];
  const transcript = String(input.transcriptPreview || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (transcript) lines.push(`语音摘要（勿抄原句进成稿）：${transcript}`);
  const climax = (input.climaxNotes || []).map((s) => String(s || "").trim()).filter(Boolean).slice(0, 6);
  if (climax.length) lines.push(`高潮窗备注：${climax.join("；")}`);
  lines.push("请按系统要求输出 JSON。");
  return lines.join("\n");
}

/** 抽帧过多时：保留前 5s 钩子 + 均匀抽样，总量 ≤ max */
export function selectFramesForVisionAnalysis<T extends { atSec: number }>(
  frames: T[],
  max = MANHUA_TEMPLATE_FRAME_VISION_MAX_FRAMES,
): T[] {
  if (frames.length <= max) return frames.slice();
  const sorted = [...frames].sort((a, b) => a.atSec - b.atSec);
  const hook = sorted.filter((f) => f.atSec <= 5.05);
  const rest = sorted.filter((f) => f.atSec > 5.05);
  const out: T[] = [...hook];
  const budget = Math.max(0, max - out.length);
  if (budget <= 0) return out.slice(0, max);
  if (rest.length <= budget) return [...out, ...rest].slice(0, max);
  for (let i = 0; i < budget; i++) {
    const idx = Math.round((i * (rest.length - 1)) / Math.max(1, budget - 1));
    out.push(rest[idx]!);
  }
  const dedup = new Map<number, T>();
  for (const f of out) dedup.set(Math.round(f.atSec * 100), f);
  return Array.from(dedup.values())
    .sort((a, b) => a.atSec - b.atSec)
    .slice(0, max);
}

function asLane(raw: unknown, fallback: ManhuaViralTemplateLane): ManhuaViralTemplateLane {
  const s = String(raw || "").trim();
  if (LANE_SET.has(s)) return s as ManhuaViralTemplateLane;
  return fallback;
}

export function parseManhuaTemplateFrameVisionJson(
  raw: unknown,
  fallbackLane: ManhuaViralTemplateLane = "爽文逆袭",
): ManhuaTemplateFrameVisionResult | null {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    const text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1]!.trim() : text;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      obj = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;

  const nameZh = String(obj.nameZh || "").trim().slice(0, 32);
  const hook3sZh = String(obj.hook3sZh || "").trim().slice(0, 200);
  if (!nameZh || !hook3sZh) return null;

  const beatGrid = Array.isArray(obj.beatGrid)
    ? obj.beatGrid
        .map((b) => {
          const row = b as Record<string, unknown>;
          return {
            atSec: Math.max(0, Math.floor(Number(row?.atSec) || 0)),
            conflictZh: String(row?.conflictZh || "").trim().slice(0, 40),
            visualZh: String(row?.visualZh || "").trim().slice(0, 80),
          };
        })
        .filter((b) => b.conflictZh && b.visualZh)
        .slice(0, 24)
    : [];
  if (!beatGrid.length) return null;

  const cast = (obj.castShape && typeof obj.castShape === "object"
    ? (obj.castShape as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const frameNotes = Array.isArray(obj.frameNotes)
    ? obj.frameNotes
        .map((n) => {
          const row = n as Record<string, unknown>;
          return {
            atSec: Math.max(0, Math.floor(Number(row?.atSec) || 0)),
            whatShows: String(row?.whatShows || "").trim().slice(0, 160),
          };
        })
        .filter((n) => n.whatShows)
        .slice(0, 32)
    : undefined;

  return {
    model: MANHUA_TEMPLATE_FRAME_VISION_MODEL,
    reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
    nameZh,
    laneZh: asLane(obj.laneZh, fallbackLane),
    summaryZh: String(obj.summaryZh || "").trim().slice(0, 120) || "节奏骨架学习草案（待人审）",
    hook3sZh,
    beatGrid,
    scenePoolHints: (Array.isArray(obj.scenePoolHints) ? obj.scenePoolHints : [])
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 16),
    castShape: {
      leadDesireZh: String(cast.leadDesireZh || "").trim().slice(0, 80) || "待人审补欲望",
      pressureZh: String(cast.pressureZh || "").trim().slice(0, 80) || "待人审补压迫",
      foilZh: String(cast.foilZh || "").trim().slice(0, 80) || undefined,
    },
    frameNotes,
  };
}

/** 用读帧结果覆盖草案可编辑字段；强制 status=proposed */
export function applyFrameVisionToProposal(
  draft: ManhuaViralTemplateCard,
  vision: ManhuaTemplateFrameVisionResult,
): ManhuaViralTemplateCard | null {
  const noteExtra = `视觉读帧已填（内部）；仍待人审批准进库`;
  const sourceRefs = [...(draft.sourceRefs || [])];
  if (sourceRefs[0]) {
    const prev = String(sourceRefs[0].noteZh || "").trim();
    sourceRefs[0] = {
      ...sourceRefs[0],
      noteZh: [prev, noteExtra].filter(Boolean).join(" · ").slice(0, 120),
    };
  }
  const merged: ManhuaViralTemplateCard = {
    ...draft,
    nameZh: vision.nameZh,
    laneZh: vision.laneZh,
    summaryZh: vision.summaryZh,
    hook3sZh: vision.hook3sZh,
    beatGrid: vision.beatGrid,
    scenePoolHints: vision.scenePoolHints.length ? vision.scenePoolHints : draft.scenePoolHints,
    castShape: vision.castShape,
    sourceRefs,
    status: "proposed",
    updatedAt: new Date().toISOString(),
    approvedAt: undefined,
  };
  return parseManhuaViralTemplateCard(merged);
}
