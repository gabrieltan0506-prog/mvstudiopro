/**
 * 关键静帧出图前：精简优化提示词（不截断丢弃）。
 * - 模型钉死 gpt-5.6-terra
 * - 仅当输入超过 32000 时：拆段提取 → 合并成一条
 * - ≤32000：原样出图，不做精简
 * - 精简后落在 24k–28k（≤28000）即放行；仍 >28000 报错停住，禁止静默裁字
 */

import {
  MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD,
  MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT,
  splitManhuaFactoryOptimizeSource,
} from "./manhuaFactoryTextOptimize";

/** 上游 images/edits·generations 硬上限；亦为触发拆段精简的门槛 */
export const OPENAI_IMAGE_PROMPT_HARD_MAX = 32_000;

/** 关键静帧精简优化固定模型（产品已选定 Terra） */
export const MANHUA_KEYART_PROMPT_COMPACT_MODEL = "gpt-5.6-terra" as const;

/** 精简目标中枢（24k–28k 区间中部） */
export const MANHUA_KEYART_PROMPT_COMPACT_TARGET = 26_000;

/** 精简后放行上限：≤此值即可送出图 */
export const MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX = 28_000;

/** 精简目标下限（brief 提示，非硬拒） */
export const MANHUA_KEYART_PROMPT_COMPACT_PASS_MIN = 24_000;

export function needsManhuaKeyartPromptCompact(prompt: string): boolean {
  return String(prompt || "").trim().length > OPENAI_IMAGE_PROMPT_HARD_MAX;
}

/** 精简后校验：≤28k 放行；禁止静默截断 */
export function assertOpenAiImagePromptWithinLimit(prompt: string): void {
  const n = String(prompt || "").trim().length;
  if (n > MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX) {
    throw new Error(
      `关键静帧说明精简后仍过长（约 ${n} 字，放行上限 ${MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX}）。请缩短本镜分镜描述后重试，系统不会截断内容。`,
    );
  }
}

export function buildManhuaKeyartPromptCompactBrief(opts?: {
  targetMax?: number;
  mode?: "extract" | "merge";
  partIndex?: number;
  partTotal?: number;
}): string {
  const target = Math.min(
    MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX,
    Math.max(2000, opts?.targetMax ?? MANHUA_KEYART_PROMPT_COMPACT_TARGET),
  );
  const mode = opts?.mode || "merge";
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
  return [
    "你是漫剧关键静帧提示精简助手。把下列分段要点合并成**一条**可直接用于参考图改图的中文提示词。",
    `硬性：输出总长必须落在 ${MANHUA_KEYART_PROMPT_COMPACT_PASS_MIN}–${MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX} 字（目标约 ${target} 字）；只输出提示词正文，不要解释。`,
    "必须保留：本镜动作构图、人物身份一致、场景与光色、画风硬锁、禁字/无字幕、融图/垫图相关句。",
    "删除重复与剧情旁白；手法用中性标签，不写导演名/供应商/模型名。",
  ].join("\n");
}

export type ManhuaKeyartCompactOptimize = (input: {
  sourceText: string;
  optimizationBrief?: string;
  modelName?: string;
}) => Promise<string>;

async function extractParts(
  optimizeCopy: ManhuaKeyartCompactOptimize,
  text: string,
  modelName: string,
): Promise<string[]> {
  const chunks = splitManhuaFactoryOptimizeSource(text, {
    softMax: MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT,
    hardMax: MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD,
  });
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
  return extracts;
}

/**
 * 出图前：仅输入 >32000 时拆段提取→合并；钉 Terra；不截断。
 * 合并结果 ≤28000（24k–28k 放行带）即返回。
 */
export async function compactManhuaKeyartImagePrompt(
  optimizeCopy: ManhuaKeyartCompactOptimize,
  rawPrompt: string,
  opts?: { targetMax?: number },
): Promise<string> {
  const text = String(rawPrompt || "").trim();
  if (!text) return text;
  // ≤32k：原样送出图，不做精简
  if (!needsManhuaKeyartPromptCompact(text)) return text;

  const target = Math.min(
    MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX,
    Math.max(2000, opts?.targetMax ?? MANHUA_KEYART_PROMPT_COMPACT_TARGET),
  );
  const modelName = MANHUA_KEYART_PROMPT_COMPACT_MODEL;

  let extracts = await extractParts(optimizeCopy, text, modelName);
  if (!extracts.length) {
    throw new Error(
      `关键静帧说明过长（约 ${text.length} 字），精简提取未得到可用要点。请缩短本镜分镜描述后重试，系统不会截断内容。`,
    );
  }

  for (let round = 0; round < 3; round++) {
    const mergedSource = extracts.join("\n\n---\n\n");
    if (mergedSource.length <= OPENAI_IMAGE_PROMPT_HARD_MAX) {
      const merged = String(
        await optimizeCopy({
          sourceText:
            mergedSource.length >= 10 ? mergedSource : `${mergedSource}\n（合并为本镜改图提示）`,
          optimizationBrief: buildManhuaKeyartPromptCompactBrief({
            targetMax: target,
            mode: "merge",
          }),
          modelName,
        }),
      ).trim();
      if (!merged) {
        throw new Error(
          `关键静帧说明过长（约 ${text.length} 字），合并精简失败。请缩短本镜分镜描述后重试，系统不会截断内容。`,
        );
      }
      // 24k–28k 放行：≤28000 即出图
      if (merged.length <= MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX) {
        return merged;
      }
      // 仍超放行上限：把合并稿再当输入继续压（不截断）
      extracts = await extractParts(optimizeCopy, merged, modelName);
      if (!extracts.length) break;
      continue;
    }
    extracts = await extractParts(optimizeCopy, mergedSource, modelName);
    if (!extracts.length) break;
  }

  throw new Error(
    `关键静帧说明过长（约 ${text.length} 字），拆段精简后仍无法压到 ${MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX} 字以内（放行带 ${MANHUA_KEYART_PROMPT_COMPACT_PASS_MIN}–${MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX}）。请缩短本镜分镜描述后重试，系统不会截断内容。`,
  );
}
