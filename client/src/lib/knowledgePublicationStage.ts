// 图文知识手册前台阶段与整册预览读取（1111）：与整理/导出状态分开，纯函数便于单测。
/**
 * 前台阶段（用户可见，不含模型/通道名）：逐章整理 → 统稿 → 整册排版 → 版面审查与 PDF。
 * 1111 站长令：生图前已集中联网核实，审校后不再重复「联网校验」；排版后只做确定性版面审查（不调模型）。
 * 旧稿仍在跑的全册核对批次计入「统稿」的进度计数。
 */
export const KNOWLEDGE_PUBLICATION_STAGES = ["逐章整理", "统稿", "整册排版", "版面审查与 PDF"] as const;
export type KnowledgePublicationStage = { step: number; done?: number; total?: number };
/** 整册预览读取：首读失败后按退避自动重试最多 3 次；与整理/导出状态分开显示。 */
export const KNOWLEDGE_PREVIEW_RETRY_DELAYS_MS = [2000, 5000, 10000] as const;
export const KNOWLEDGE_PREVIEW_UNAVAILABLE = "整册预览暂时读不出（已自动重试 3 次）。排版方案已保存，导出与下载不受影响，可稍后点「重新读取预览」。";
export function knowledgeStageLabel(stage: KnowledgePublicationStage | null) {
  if (!stage) return "";
  if (stage.step >= KNOWLEDGE_PUBLICATION_STAGES.length) return "全部完成：" + KNOWLEDGE_PUBLICATION_STAGES.join(" → ");
  return KNOWLEDGE_PUBLICATION_STAGES.map((name, i) => {
    const count = i === stage.step && stage.total ? ` ${stage.done ?? 0}/${stage.total}` : "";
    return i < stage.step ? `${name} ✓` : i === stage.step ? `【${name}${count}】` : name;
  }).join(" → ");
}
/**
 * 预览读取：同一稿件版本复用；导出进行中不发起；失败退避重试。纯函数便于单测。
 */
export async function loadKnowledgePreviewWithRetry<T>(fetch: () => Promise<T>, options: { alive: () => boolean; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, error: unknown) => void }) {
  const sleep = options.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try { return { ok: true as const, value: await fetch() }; }
    catch (error) {
      if (!options.alive()) return { ok: false as const, error };
      if (attempt >= KNOWLEDGE_PREVIEW_RETRY_DELAYS_MS.length) return { ok: false as const, error };
      options.onRetry?.(attempt + 1, error);
      await sleep(KNOWLEDGE_PREVIEW_RETRY_DELAYS_MS[attempt]!);
      if (!options.alive()) return { ok: false as const, error };
    }
  }
}
