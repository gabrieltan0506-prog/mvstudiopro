/**
 * 关键静帧出图前：精简优化提示词（不截断丢弃）。
 * - 本镜说明过长时先走文案优化压成可改图短提示
 * - 输入超单次优化上限时拆段提取要点，再合并为一条
 * - 上游出图接口硬上限 32000：仅用于校验；超限报错，禁止静默裁字
 */

import {
  MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD,
  MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT,
  splitManhuaFactoryOptimizeSource,
} from "./manhuaFactoryTextOptimize";

/** 上游 images/edits·generations 硬上限（非我们业务设定） */
export const OPENAI_IMAGE_PROMPT_HARD_MAX = 32_000;

/** 超过此长度才触发精简（短镜跳过，省时） */
export const MANHUA_KEYART_PROMPT_COMPACT_SOFT = 10_000;

/** 精简后目标上限（留余量给禁字尾/融图句） */
export const MANHUA_KEYART_PROMPT_COMPACT_TARGET = 12_000;

export function needsManhuaKeyartPromptCompact(prompt: string): boolean {
  return String(prompt || "").trim().length > MANHUA_KEYART_PROMPT_COMPACT_SOFT;
}

export function assertOpenAiImagePromptWithinLimit(prompt: string): void {
  const n = String(prompt || "").trim().length;
  if (n > OPENAI_IMAGE_PROMPT_HARD_MAX) {
    throw new Error(
      `关键静帧说明精简后仍过长（约 ${n} 字，上游上限 ${OPENAI_IMAGE_PROMPT_HARD_MAX}）。请缩短本镜分镜描述后重试，系统不会截断内容。`,
    );
  }
}

export function buildManhuaKeyartPromptCompactBrief(opts?: {
  targetMax?: number;
  mode?: "full" | "extract" | "merge";
  partIndex?: number;
  partTotal?: number;
}): string {
  const target = Math.max(2000, opts?.targetMax ?? MANHUA_KEYART_PROMPT_COMPACT_TARGET);
  const mode = opts?.mode || "full";
  if (mode === "extract") {
    const i = Math.max(1, Math.floor(opts?.partIndex || 1));
    const n = Math.max(1, Math.floor(opts?.partTotal || 1));
    return [
      "你是漫剧关键静帧提示精简助手。从本段原文提取「改图必备」要点列表，不要写故事复述。",
      `【分段提取 ${i}/${n}】只输出要点，总长尽量 ≤2500 字。`,
      "必须保留（若原文有）：本镜分镜号与画面动作、人物身份/妆造、场景材质光色、画风硬锁、禁字/无字幕要求、垫图/融图指令。",
      "删除：整集剧情复述、重复锚点、上游反推全文、与本镜无关的场次。",
      "输出用中文短句/小标题，勿加前言后语。",
    ].join("\n");
  }
  if (mode === "merge") {
    return [
      "你是漫剧关键静帧提示精简助手。把下列分段要点合并成**一条**可直接用于参考图改图的中文提示词。",
      `硬性：输出总长必须 ≤${target} 字；只输出提示词正文，不要解释。`,
      "必须保留：本镜动作构图、人物身份一致、场景与光色、画风硬锁、禁字/无字幕、融图/垫图相关句。",
      "删除重复与剧情旁白；手法用中性标签，不写导演名/供应商/模型名。",
    ].join("\n");
  }
  return [
    "你是漫剧关键静帧提示精简助手。把原文压成**一条**可直接用于参考图改图的中文提示词。",
    `硬性：输出总长必须 ≤${target} 字；只输出提示词正文，不要解释、不要 Markdown 长文。`,
    "必须保留：本镜分镜画面与动作、人物身份/妆造、场景材质光色、画风硬锁、禁字/无字幕、垫图/融图指令。",
    "删除：整集剧情复述、重复资产锚点、上游反推全文、与本镜无关内容。",
    "手法用中性标签；禁止导演名、供应商名、模型名。",
  ].join("\n");
}

export type ManhuaKeyartCompactOptimize = (input: {
  sourceText: string;
  optimizationBrief?: string;
  modelName?: string;
}) => Promise<string>;

/**
 * 出图前精简：不截断原文；过长则拆段提取 → 合并为单条短提示。
 */
export async function compactManhuaKeyartImagePrompt(
  optimizeCopy: ManhuaKeyartCompactOptimize,
  rawPrompt: string,
  opts?: { modelName?: string; targetMax?: number },
): Promise<string> {
  const text = String(rawPrompt || "").trim();
  if (!text) return text;
  if (!needsManhuaKeyartPromptCompact(text)) return text;

  const target = Math.max(2000, opts?.targetMax ?? MANHUA_KEYART_PROMPT_COMPACT_TARGET);
  const modelName = opts?.modelName;

  const chunks = splitManhuaFactoryOptimizeSource(text, {
    softMax: MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT,
    hardMax: MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD,
  });

  if (chunks.length <= 1) {
    const out = String(
      await optimizeCopy({
        sourceText: text.length >= 10 ? text : `${text}\n（请精简为本镜改图提示）`,
        optimizationBrief: buildManhuaKeyartPromptCompactBrief({ targetMax: target, mode: "full" }),
        modelName,
      }),
    ).trim();
    return out || text;
  }

  const extracts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const part = String(
      await optimizeCopy({
        sourceText: chunk.length >= 10 ? chunk : `${chunk}\n（提取视觉要点）`,
        optimizationBrief: buildManhuaKeyartPromptCompactBrief({
          mode: "extract",
          partIndex: i + 1,
          partTotal: chunks.length,
        }),
        modelName,
      }),
    ).trim();
    if (part) extracts.push(part);
  }

  const mergedSource = extracts.join("\n\n---\n\n");
  if (!mergedSource.trim()) return text;

  const merged = String(
    await optimizeCopy({
      sourceText: mergedSource.length >= 10 ? mergedSource : `${mergedSource}\n（合并为本镜改图提示）`,
      optimizationBrief: buildManhuaKeyartPromptCompactBrief({ targetMax: target, mode: "merge" }),
      modelName,
    }),
  ).trim();

  return merged || extracts.join("\n\n") || text;
}
