/**
 * 漫剧工厂：运镜/镜头说明 → 通顺中文（GPT-5.6 Terra）
 * 人设：电影编剧与剧本创作大师；界面与 Seedance / I2V 共用中文运镜句。
 */

export const MANHUA_SCREENWRITER_TERRA_MODEL = "gpt-5.6-terra" as const;

/** 给 optimizeCustomCopy / Terra 的优化 brief（非 system，拼进用户块） */
export const MANHUA_SCREENWRITER_TRANSLATE_BRIEF = [
  "你是电影编剧与剧本创作的大师，精通中西文化与文字表达，熟悉竖屏漫剧/短剧分镜与运镜术语。",
  "任务：把下列运镜/镜头/动作说明，润色成通顺、专业、可给中文剧组直接朗读与执行的中文。",
  "硬性要求：",
  "1. 只输出中文正文，不要标题、不要 JSON、不要解释过程；若原文含英文词，一并改成自然中文。",
  "2. 保留时段结构、红轨人物/蓝轨镜头语义、动作节奏与空间关系。",
  "3. 禁止导演名、外仓品牌、模型名；禁止「轨迹线显示在成片」类表述（应写「成片不显示轨迹参考线」）。",
  "4. 文风像编剧案头说明：干净、有画面感、无公文腔。",
  "5. 将结果完整写入 optimizedMarkdown 字段（可纯段落，无需 Markdown 装饰）。",
].join("\n");

/** 粗判是否值得送 Terra（含明显英文运镜词） */
export function looksLikeEnglishMotionCopy(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 12) return false;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (latin < 16) return false;
  if (cjk > latin * 1.2) return false;
  return /subject|camera|Dual-track|along|path|FPV|Guide lines|beats/i.test(t);
}
