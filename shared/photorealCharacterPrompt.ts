/**
 * HB V7 · 去 AI 味超写实人像硬约束
 * 共用：漫剧 photoreal / 平台封面写实 / 真人情绪视频首帧。
 */

/** 面部皮肤实拍级硬锁（方案 C：必须像单反真人，而非美颜/CG） */
export const PHOTOREAL_SKIN_TEXTURE_LOCK_ZH = `【皮肤质感·必须像真人摄影】
- 面部皮肤必须像单反实拍：清晰可见毛孔、细小皮脂纹理、脸颊与鼻翼轻微自然泛红差、极淡雀斑或细微瑕疵；可见细小绒毛（面部汗毛）在侧光下。
- 禁止磨皮、禁止塑料反光、禁止美颜 APP 感、禁止蜡像/人偶脸、禁止均匀瓷器肤色。
- 仍保持干净通透的「真人漂亮皮肤」，禁止粗糙问题肌与人为高光油面。`.trim();

/** 中文硬锁：皮肤真实度 + 轻微不对称 + 禁塑料脸 */
export const PHOTOREAL_ANTI_AI_LOCK_ZH = `【去 AI 味·超写实人像硬锁】
${PHOTOREAL_SKIN_TEXTURE_LOCK_ZH}
- 不对称：保留极轻微自然不对称（眼裂开合、嘴角、眉高、唇形），增强真实度；禁止明显畸形或五官漂移。
- 妆容：轻薄通透、自然唇色与轻微光泽；睫毛自然清晰；忌网红厚妆假面。
- 光影：充足通透、层次丰富的自然光或高级棚拍光；柔和但可见的明暗，突出立体感；浅景深焦点可落眼部。
- 表情：情绪克制细腻，忌夸张表演与 AI 僵硬感；可有轻微泪光/鼻头微红等真实生理细节，但勿狼狈大面积泛红。
- 负面：塑料感皮肤、过度磨皮、完美对称人偶脸、蜡像感、假瞳孔、字幕水印、过度美颜变成陌生人。`.trim();

export const PHOTOREAL_ANTI_AI_LOCK_EN = [
  "photoreal anti-AI lock: visible pores, real skin texture, fine vellus hair, subtle natural asymmetry",
  "no plastic skin, no heavy airbrush, no doll-perfect symmetry, no wax-figure sheen",
  "clean natural makeup, translucent base, authentic lip color",
  "bright layered natural or soft studio light, shallow DOF on eyes",
  "restrained emotion, no exaggerated AI acting, no watermark/subtitles",
].join("; ");

/** 情绪微表情视频通用壳（9:16） */
export function buildPhotorealEmotionVideoShell(opts: {
  emotionZh: string;
  intensity?: number;
  beatSheetZh: string;
}): string {
  const intensity = Math.max(1, Math.min(10, opts.intensity ?? 7));
  return [
    "画面配置：竖屏 9:16，写实真人感情绪表情视频，自然晃动手持机位，中近景半身构图。",
    "人物保持首帧一致，面对镜头，真实皮肤肌理、汗毛毛孔；镜头稳定，面部清晰。",
    "不要字幕，不要水印，不要夸张表演，不要 AI 僵硬感。",
    `情绪设定：${opts.emotionZh}。情绪强度 ${intensity} 分。`,
    "分秒拆解：",
    opts.beatSheetZh,
    "",
    PHOTOREAL_ANTI_AI_LOCK_ZH,
  ].join("\n");
}

export function appendPhotorealAntiAiGuidance(
  base: string,
  opts?: { maxChars?: number; lang?: "zh" | "en" | "both" },
): string {
  const maxChars = opts?.maxChars ?? 4200;
  const lang = opts?.lang ?? "zh";
  const trimmed = String(base || "").trim();
  const blocks: string[] = [];
  if (trimmed) blocks.push(trimmed);
  if ((lang === "zh" || lang === "both") && !/去 AI 味·超写实/.test(trimmed)) {
    blocks.push(PHOTOREAL_ANTI_AI_LOCK_ZH);
  }
  if ((lang === "en" || lang === "both") && !/photoreal anti-AI lock/i.test(trimmed)) {
    blocks.push(`【Photoreal anti-AI】${PHOTOREAL_ANTI_AI_LOCK_EN}`);
  }
  return blocks.join("\n\n").trim().slice(0, maxChars);
}
