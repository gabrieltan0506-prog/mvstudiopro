/**
 * 分镜灯光 / 情绪：大师级导演语汇库（软边界）。
 * 高度需求达到电影导演级光影与情绪调度；包括但不限于下列导演的可迁移手法，
 * 按段落叙事选用，勿每格机械复读同一人名。
 */

/** 中文主体内：六栏表字段 */
export const STORYBOARD_PANEL_TABLE_FIELDS_ZH =
  "景别 / 运镜 / 灯光安排 / 情绪表达 / 画面内容 / 台词与音效";

/** 英文像素锁用字段名 */
export const STORYBOARD_PANEL_TABLE_FIELDS_EN =
  "**景别**, **运镜**, **灯光安排**, **情绪表达**, **画面内容**, **台词与音效**";

/**
 * 大师级导演灯光·情绪参考卡（可代码化复用）。
 * 说明：写的是可迁移的光影/情绪语法，不是要求画面出现导演署名或抄袭某一镜头。
 */
export const MASTER_DIRECTOR_LIGHTING_EMOTION_PROFILES = [
  {
    id: "nolan",
    nameZh: "克里斯托弗·诺兰",
    nameEn: "Christopher Nolan",
    lightingZh:
      "大画幅质感、高反差明暗、实用光与建筑空间塑形；冷暖对切服务时间/记忆张力；少用廉价柔光糊脸",
    emotionZh: "克制、压迫、智性悬疑；情绪靠空间与节奏累积，少夸张表演",
    lightingEn:
      "IMAX-like clarity, high-contrast practicals, architectural light shaping; cool/warm cuts for temporal tension",
    emotionEn: "restrained intellectual dread; emotion via space and rhythm, not melodrama",
  },
  {
    id: "spielberg",
    nameZh: "史蒂文·斯皮尔伯格",
    nameEn: "Steven Spielberg",
    lightingZh:
      "温暖主光与轮廓光、魔术时刻金晖、体积光/尘雾光束；面部可读、希望感与奇迹感并重",
    emotionZh: "好奇、敬畏、亲情与发现；镜头邀请观众一起看见",
    lightingEn:
      "warm key + rim, magic-hour glow, volumetric god-rays; faces always readable",
    emotionEn: "wonder, awe, familial warmth; camera invites discovery",
  },
  {
    id: "abrams",
    nameZh: "J.J.·艾布拉姆斯",
    nameEn: "J.J. Abrams",
    lightingZh:
      "镜头光晕/anamorphic flare、高对比剪影、霓虹与实用光点缀；暗部保留细节",
    emotionZh: "神秘、期待、突然揭示；情绪随信息缺口拉扯",
    lightingEn:
      "anamorphic lens flares, silhouette contrast, neon/practical sparkles; retain shadow detail",
    emotionEn: "mystery, anticipation, reveal; emotion from information gaps",
  },
  {
    id: "villeneuve",
    nameZh: "丹尼斯·维伦纽瓦",
    nameEn: "Denis Villeneuve",
    lightingZh:
      "极简大面积光域、雾霾散射、冷灰青调、远景压迫；人物常被环境光吞没又被一束光找回",
    emotionZh: "疏离、庄严、存在主义静默；少台词多气氛",
    lightingEn:
      "minimalist large light fields, haze scatter, cold teal-grey; figure recovered by a single beam",
    emotionEn: "alienation, solemn quiet; atmosphere over dialogue",
  },
  {
    id: "wong",
    nameZh: "王家卫",
    nameEn: "Wong Kar-wai",
    lightingZh:
      "霓虹色溢、潮湿反射、慢门残影感、暖黄与青绿对撞；近景皮肤纹理与光斑",
    emotionZh: "暧昧、怀旧、欲言又止；时间被拉长的情绪余韵",
    lightingEn:
      "neon spill, wet reflections, warm amber vs teal clash; intimate skin texture and flares",
    emotionEn: "ambiguous longing, nostalgia; stretched emotional aftertaste",
  },
  {
    id: "fincher",
    nameZh: "大卫·芬奇",
    nameEn: "David Fincher",
    lightingZh:
      "精密控光、低饱和、顶侧硬光切面、青冷阴影；画面干净如手术刀",
    emotionZh: "偏执、冷静、不安；情绪被压在细节与构图里",
    lightingEn:
      "precision-controlled light, desaturated, hard top-side cuts, cyan-cool shadows",
    emotionEn: "obsessive calm unease; emotion in detail and framing",
  },
  {
    id: "kurosawa",
    nameZh: "黑泽明",
    nameEn: "Akira Kurosawa",
    lightingZh:
      "天气即灯光（风雨尘雾）、深远透视、群像层次光；自然光戏剧化",
    emotionZh: "史诗正义感、人性拉扯、群体情绪浪潮",
    lightingEn:
      "weather-as-light (rain/wind/dust), deep perspective, layered group lighting",
    emotionEn: "epic moral tension; crowd emotion as wave",
  },
  {
    id: "deakins",
    nameZh: "罗杰·迪金斯（摄影指导语汇）",
    nameEn: "Roger Deakins (DP grammar)",
    lightingZh:
      "自然主义动机光、窗光塑形、柔和衰减、真实空间逻辑；高级但不炫技",
    emotionZh: "诚实、沉静、人物内心可见",
    lightingEn:
      "motivated naturalistic window light, soft falloff, real-space logic; elegant not flashy",
    emotionEn: "honest stillness; inner life readable on face",
  },
] as const;

function formatDirectorCardsZh(): string {
  return MASTER_DIRECTOR_LIGHTING_EMOTION_PROFILES.map(
    (d, i) =>
      `${i + 1}. **${d.nameZh}（${d.nameEn}）**\n   - 灯光语法：${d.lightingZh}\n   - 情绪语法：${d.emotionZh}`,
  ).join("\n");
}

function formatDirectorCardsEn(): string {
  return MASTER_DIRECTOR_LIGHTING_EMOTION_PROFILES.map(
    (d) =>
      `- ${d.nameEn}: lighting — ${d.lightingEn}; emotion — ${d.emotionEn}`,
  ).join("\n");
}

/**
 * 中文：分镜灯光与情绪高度需求（大师级导演水准·软边界）
 */
export const STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH = `【灯光与情绪·大师级导演水准·高度需求·软边界】
每一格分镜表**强烈建议**写清 **灯光安排** 与 **情绪表达**，目标是**大师级电影导演**的光影调度与情绪感染力——不是手机自拍平光，也不是说明书式布光。

## 高度需求
- **灯光安排**：主光方向/质感、色温冷暖、明暗比、轮廓光/实用光；包括但不限于侧光、逆光、伦勃朗、窗光、体积光、霓虹溢光、魔术时刻等，**必须服务本格叙事与人物情绪**。
- **情绪表达**：微表情、身体张力、气氛关键词；镜头让观众「感到」而非只「看见」。
- **跨格情绪弧线**：开场→冲突→洞察→收束，光影与情绪同步递进（例如：克制好奇 → 共鸣紧绷 → 释然邀请）。

## 大师级参考语汇（包括但不限于，按段落选用，勿每格复读同一导演名）
${formatDirectorCardsZh()}

画内表文字宜短（每栏建议≤12–16字）；完整光影与情绪说明写在脚本【灯光机位】【情绪弧线】字段。`;

/** 英文：像素锁后追加的大师级灯光/情绪指引（软边界） */
export const STORYBOARD_LIGHTING_EMOTION_LOCK_EN = `MASTER-DIRECTOR LIGHTING & EMOTION (HIGHLY RECOMMENDED, soft boundary):
Each panel table should include short Simplified Chinese for **灯光安排** and **情绪表达** at **feature-film director craft level** — motivated cinematic lighting and readable emotional performance, not flat phone light.
Draw from (including but not limited to) these director grammars — pick per beat, do not stamp the same name on every panel:
${formatDirectorCardsEn()}
Prefer larger glyphs; keep each cell short (≤12–14 chars).`;

/** 写入 Stage2 / 自定义选题 executionDetails 的短提示 */
export const STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH = `【灯光机位与情绪·大师级·高度需求】lightingAndCamera 与 stepByStepScript **强烈建议**达到电影导演级水准：写清主光/色温/明暗比与情绪弧线。可借鉴包括但不限于 Christopher Nolan（高反差建筑光）、Steven Spielberg（温暖魔术时刻与敬畏感）、J.J. Abrams（光晕剪影与期待感）、Denis Villeneuve（雾霾大光域与静默）、Wong Kar-wai（霓虹暧昧）、David Fincher（精密冷光）、Akira Kurosawa（天气即光）、Roger Deakins 式动机窗光——按段落选用，勿机械复读。`;
