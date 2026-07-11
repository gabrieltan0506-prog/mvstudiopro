/**
 * 平台选题封面 / 分镜：人物造型与时装大片气质（全案 + 自定义共用）。
 * 风格锚点：VOGUE / ELLE / Harper's Bazaar / 好莱坞时尚编辑。
 */

/** 中文块：写入 coverPersonaContext / 分镜 scriptContext */
export const PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH = `【人物造型·国际时尚大片】
整体风格参考《VOGUE》《ELLE》《Harper's Bazaar》与好莱坞时尚编辑大片：高级、时尚、自信、有明星感。
【人物设定】
- 妆容干净高级，皮肤细腻通透，带真实皮肤纹理与高级光泽；头发自然舒展，带轻微电影感空气感。
- **封面优先停滑抓人**：表情与姿势须丰富有戏（大笑、错愕、陶醉、坏笑、跳跃、失衡、探身、回头等择一），禁止默认「正面端坐/端站上课脸、证件照微笑、挺拔冷淡讲课站姿」。分镜格内可更克制，但仍忌每格同一张正经正脸。
【服装要求】
- 配合场景生成合适且高雅/高贵的穿搭（场景决定场域，服装决定阶层气质，二者须统一）。
- 高级时装配色优先：深蓝、黑色、奶油白、灰色等克制高级色；可有一处克制强调色。
- 单品任选且贴合人设与场景：西装、礼服、西装裙、高定外套、丝绸衬衫等；面料须有真实高级质感（羊毛、丝绸、缎面、天鹅绒）。
- 轻奢配饰可点缀但勿硬配：手提包、高级腕表、项链、戒指、翡翠等；男女款式与种类须区分，与服装造型整体统一，营造「国际时尚大片」感。
- 若脚本含古人/历史角色等独立造型，可例外；现代主讲/主人公须遵守上述时装编辑标准。`.trim();

/** 英文修饰：叠加入摄影 modifiers / 英文 prompt 尾 */
export const PLATFORM_FASHION_EDITORIAL_CHARACTER_EN = [
  "VOGUE / ELLE / Harper's Bazaar / Hollywood fashion-editorial character styling",
  "high-fashion, confident, celebrity presence; for covers prefer expressive stop-scroll moments (laugh, surprise, bliss, smirk, jump, off-balance, lean-in) — never default stiff frontal lecture-pose or ID-photo smile",
  "clean elevated makeup, refined translucent skin with real texture and luxe sheen",
  "hair naturally flowing with cinematic airiness",
  "wardrobe matched to the scene: elegant/noble couture in navy, black, cream, grey",
  "tailored suit, evening gown, suit dress, couture coat, or silk shirt with authentic wool/silk/satin/velvet texture",
  "optional understated luxury accessories (handbag, watch, necklace, ring, jade) gender-appropriate — never forced clutter",
  "international fashion campaign look, not cheap influencer filter aesthetic",
].join("; ");

/** 拼入 persona / script，避免重复堆叠 */
export function appendFashionEditorialCharacterGuidance(
  base: string,
  opts?: { maxChars?: number; lang?: "zh" | "en" | "both" },
): string {
  const maxChars = opts?.maxChars ?? 4200;
  const lang = opts?.lang ?? "zh";
  const blocks: string[] = [];
  const trimmed = String(base || "").trim();
  if (trimmed) blocks.push(trimmed);
  const hasZh = /国际时尚大片|Harper'?s Bazaar|VOGUE/.test(trimmed);
  if (!hasZh && (lang === "zh" || lang === "both")) {
    blocks.push(PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH);
  }
  if (lang === "en" || lang === "both") {
    if (!/fashion-editorial character styling/i.test(trimmed)) {
      blocks.push(`【Fashion editorial】${PLATFORM_FASHION_EDITORIAL_CHARACTER_EN}`);
    }
  }
  return blocks.join("\n\n").trim().slice(0, maxChars);
}
