/**
 * 平台中文输出统一为**大陆简体（zh-Hans）**。
 * Gemini / Nano Banana 2 常默认繁体；文案后处理 + 出图 prompt 锁一起兜底。
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

/** Nano Banana 2 / Vertex 出图：屏内汉字简体锁（英文指令对图像模型更稳）。 */
export const NANO_BANANA2_SIMPLIFIED_ZH_LOCK = `
LANGUAGE LOCK (CRITICAL — ON-IMAGE TEXT):
- All Chinese glyphs rendered in the image MUST be Mainland **Simplified Chinese** (简体中文 / zh-Hans).
- NEVER render Traditional Chinese characters (繁體字), e.g. 髮/學/體/東/龍/優/導/畫/臺.
- If the brief contains Traditional characters, convert them to Simplified BEFORE painting text.
- Keep English labels only when the brief explicitly requires English; Chinese body text stays Simplified.
`.trim();

/** 把简体锁追加到生图 prompt，并把已有汉字尽量转成简体。 */
export function enforceSimplifiedChineseImagePrompt(prompt: string): string {
  const base = toSimplifiedChinese(String(prompt || "").trim());
  if (!base) return NANO_BANANA2_SIMPLIFIED_ZH_LOCK;
  if (base.includes("Simplified Chinese") && base.includes("简体中文")) {
    return base;
  }
  return `${base}\n\n${NANO_BANANA2_SIMPLIFIED_ZH_LOCK}`;
}
