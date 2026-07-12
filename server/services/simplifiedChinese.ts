/**
 * 平台中文输出统一为**大陆简体（zh-Hans）**。
 * Gemini / Nano Banana 2 / GPT-Image-2 常默认繁体；文案后处理 + 出图 prompt 锁一起兜底。
 */
import * as OpenCC from "opencc-js";

const twToCn = OpenCC.Converter({ from: "tw", to: "cn" });
const hkToCn = OpenCC.Converter({ from: "hk", to: "cn" });

/** 文案 / JSON：繁体 → 简体（先 tw 再 hk，覆盖常见字形）。 */
export function toSimplifiedChinese(text: string): string {
  const raw = String(text ?? "");
  if (!raw) return raw;
  return hkToCn(twToCn(raw));
}

/** Gemini Flash 文案 system 硬约束。 */
export const GEMINI_COPY_SIMPLIFIED_ZH_LOCK = `【语言硬约束 · CRITICAL】
1. 所有面向用户的中文必须是**中国大陆简体中文（Simplified Chinese / zh-Hans）**。
2. **严禁**使用繁体字（Traditional Chinese），例如：髮、學、體、東、龍、臺灣、資訊、優化、導演、畫面。
3. 若内部思考或检索结果含繁体，输出前必须先转为简体；专有名词亦优先用大陆通行写法。
4. JSON 字段内的全部中文字符同样必须是简体。`;

/** 出图（封面 / 分镜 / 图文 / NB2 / GPT-Image-2）：屏内汉字简体锁。 */
export const NANO_BANANA2_SIMPLIFIED_ZH_LOCK = `
LANGUAGE LOCK (CRITICAL — ON-IMAGE TEXT):
- All Chinese glyphs rendered in the image MUST be Mainland **Simplified Chinese** (简体中文 / zh-Hans).
- NEVER render Traditional Chinese characters (繁體字 / zh-Hant). Forbidden examples include traditional forms of fa/xue/ti/dong/long/you/dao/hua/tai.
- If the brief contains Traditional characters, convert them to Simplified BEFORE painting text.
- Keep English labels only when the brief explicitly requires English; Chinese body text stays Simplified.
`.trim();

const IMAGE_PROMPT_SIMP_MARKER = "LANGUAGE LOCK (CRITICAL — ON-IMAGE TEXT)";

/** 把简体锁追加到生图 prompt，并把已有汉字尽量转成简体（封面/分镜/图文/任意引擎通用）。 */
export function enforceSimplifiedChineseImagePrompt(prompt: string): string {
  const raw = String(prompt || "").trim();
  if (!raw) return NANO_BANANA2_SIMPLIFIED_ZH_LOCK;
  // 已加过锁：原样返回，避免再次 OpenCC 改写 lock 内举例
  if (raw.includes(IMAGE_PROMPT_SIMP_MARKER)) return raw;
  const base = toSimplifiedChinese(raw);
  return `${base}\n\n${NANO_BANANA2_SIMPLIFIED_ZH_LOCK}`;
}
