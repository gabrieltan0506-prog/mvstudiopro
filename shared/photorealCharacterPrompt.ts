/**
 * HB V7 · 去 AI 味超写实人像硬约束
 * 共用：漫剧 photoreal / 平台封面写实 / 真人情绪视频首帧。
 */

/** 库图=现代定妆底；分镜换装时只锁五官骨相，服装跟场景走 */
export const PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH = `【锁脸不锁服·跨场景】
- 锁：五官比例、下颌/颧骨骨相、发际线与瞳色气质；跨镜头须同一人。
- 不锁：服装、配饰、发型长短可按场景改（古装/职场/校园/仙侠等），禁止因换装换脸。
- 库内现代定妆图仅作身份底；出古装/奇幻戏时换衣不换骨相。`.trim();

/** 禁止网感锥子脸塌缩（生成 + edit 共用） */
export const PHOTOREAL_ANTI_HOMOGENEOUS_JAW_ZH = `【反同质下巴】
禁止全员尖下巴/小V脸/锥子脸；禁止过窄下颌与幼态过小下巴；下颌宽度与颧骨须有个体差异。`.trim();

export type PhotorealFaceShapePreset = {
  id: string;
  labelZh: string;
  /** 写入生图/edit 的骨相指令 */
  promptZh: string;
};

/** 女主骨相轮盘（按角色 id 稳定取模，拉开下颌差异） */
export const PHOTOREAL_FACE_SHAPE_FEMALE: PhotorealFaceShapePreset[] = [
  {
    id: "f_oval_mod",
    labelZh: "鹅蛋·中等下颌",
    promptZh: "鹅蛋脸，中等宽度下颌，下巴圆钝有肉，颧骨自然，禁止尖锥下巴。",
  },
  {
    id: "f_round_full",
    labelZh: "圆脸·丰润下庭",
    promptZh: "圆脸，面颊丰润，下庭饱满，下巴短圆，下颌线柔和偏宽。",
  },
  {
    id: "f_soft_square",
    labelZh: "软方脸",
    promptZh: "软方脸，下颌角清晰但不锋利，下巴宽度接近颧骨，面部偏短。",
  },
  {
    id: "f_long_oval",
    labelZh: "长鹅蛋·实质下巴",
    promptZh: "略长鹅蛋脸，中庭偏长，下巴有实质长度与宽度，禁止小尖下巴。",
  },
  {
    id: "f_diamond",
    labelZh: "菱形·颧高颌收有度",
    promptZh: "菱形脸，颧骨略高，下颌收窄但保留可见下颌角，下巴圆钝非针尖。",
  },
  {
    id: "f_heart_soft",
    labelZh: "柔心形·下庭不削",
    promptZh: "柔心形脸，额略宽，下庭收但不削成锥子；下巴圆、有厚度。",
  },
  {
    id: "f_wide_jaw",
    labelZh: "宽下颌·国字柔化",
    promptZh: "偏宽下颌的柔国字脸，下颌角明显，下巴方圆，气场沉稳。",
  },
  {
    id: "f_oblong",
    labelZh: "长脸·平直颌线",
    promptZh: "长脸，两侧轮廓较直，下巴偏方圆、略长，禁止心形小V。",
  },
  {
    id: "f_pear",
    labelZh: "梨形·下庭更宽",
    promptZh: "梨形倾向：下庭与下颌宽于颧骨，下巴宽圆，面相踏实。",
  },
  {
    id: "f_oval_soft_chin",
    labelZh: "椭圆·圆润下庭",
    promptZh: "椭圆脸，下颌线流畅，下巴圆润中等，面颊有轻微肉感。",
  },
  {
    id: "f_square_strong",
    labelZh: "方脸·有力下颌",
    promptZh: "方脸，下颌角有力，下巴宽平略圆，禁止幼态尖下巴。",
  },
  {
    id: "f_round_short",
    labelZh: "短圆脸",
    promptZh: "短圆脸，中庭偏短，下巴短而圆，下颌宽柔。",
  },
  {
    id: "f_sculpted",
    labelZh: "立体·中宽下颌",
    promptZh: "立体骨相，颧骨适中，下颌中宽，下巴圆钝带轻微棱角。",
  },
  {
    id: "f_soft_long",
    labelZh: "柔长脸",
    promptZh: "柔和长脸，下颌线长而润，下巴圆、宽度中等偏宽。",
  },
  {
    id: "f_balanced",
    labelZh: "均衡三庭",
    promptZh: "三庭均衡的椭圆脸，下颌与颧骨宽度接近，下巴自然圆钝。",
  },
];

/** 男主骨相轮盘 */
export const PHOTOREAL_FACE_SHAPE_MALE: PhotorealFaceShapePreset[] = [
  {
    id: "m_square_lantern",
    labelZh: "方脸·灯笼颌",
    promptZh: "方脸，下颌角宽厚，下巴方正有力，男性骨相清晰。",
  },
  {
    id: "m_oval_mod",
    labelZh: "鹅蛋·中宽下颌",
    promptZh: "鹅蛋偏方，中等偏宽下颌，下巴圆钝有重量，禁止小尖下巴。",
  },
  {
    id: "m_long_rect",
    labelZh: "长方脸",
    promptZh: "长方脸，两侧较直，下颌结实，下巴略长而宽。",
  },
  {
    id: "m_round_soft",
    labelZh: "圆润男脸",
    promptZh: "偏圆男脸，面颊有肉，下颌柔和偏宽，下巴短圆。",
  },
  {
    id: "m_diamond",
    labelZh: "菱形·锐但不尖",
    promptZh: "菱形脸，颧骨略高，下颌收但保留角感，下巴圆钝非锥。",
  },
  {
    id: "m_wide_jaw",
    labelZh: "宽下颌",
    promptZh: "明显宽下颌，下颌角突出，下巴宽平，气场强。",
  },
  {
    id: "m_soft_square",
    labelZh: "软方脸",
    promptZh: "软方脸，下颌角圆钝有轮廓，下巴中宽。",
  },
  {
    id: "m_oblong",
    labelZh: "长脸·实质下巴",
    promptZh: "长脸，下巴有实质长度与宽度，禁止幼态小下巴。",
  },
  {
    id: "m_heart_soft",
    labelZh: "柔心形男",
    promptZh: "额略宽的柔心形，下庭收但不尖，下巴圆有厚度。",
  },
  {
    id: "m_rugged",
    labelZh: "粗粝骨相",
    promptZh: "颧骨与下颌都偏强，下巴方厚，皮肤纹理可见。",
  },
  {
    id: "m_balanced",
    labelZh: "均衡三庭",
    promptZh: "三庭均衡，下颌中宽，下巴方圆自然。",
  },
  {
    id: "m_narrow_long",
    labelZh: "偏窄长脸·颌仍有力",
    promptZh: "脸略窄而长，但下颌线有力、下巴不尖不小。",
  },
  {
    id: "m_short_square",
    labelZh: "短方面孔",
    promptZh: "面短偏方，下颌宽，下巴短而有力。",
  },
  {
    id: "m_sculpted",
    labelZh: "立体中颌",
    promptZh: "立体骨相，下颌中宽清晰，下巴圆钝带棱。",
  },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** 按角色 id 稳定取骨相（同 id 永远同一档） */
export function getPhotorealFaceShapeForId(
  id: string,
  gender: "female" | "male",
): PhotorealFaceShapePreset {
  const table = gender === "female" ? PHOTOREAL_FACE_SHAPE_FEMALE : PHOTOREAL_FACE_SHAPE_MALE;
  const idx = hashId(String(id || "").trim() || "x") % table.length;
  return table[idx]!;
}

export function formatPhotorealFaceShapeBlock(id: string, gender: "female" | "male"): string {
  const shape = getPhotorealFaceShapeForId(id, gender);
  return [`【骨相轮盘·${shape.labelZh}】`, shape.promptZh, PHOTOREAL_ANTI_HOMOGENEOUS_JAW_ZH].join(
    "\n",
  );
}

/** 面部皮肤实拍级硬锁（方案 C：必须像单反真人，而非美颜/CG） */
export const PHOTOREAL_SKIN_TEXTURE_LOCK_ZH = `【皮肤质感·必须像真人摄影】
- 面部皮肤必须像单反/微单实拍：鼻翼与面中清晰可见毛孔与皮脂纹理，不是磨皮；颧骨/鼻头有轻微血色差与细微瑕疵（极淡雀斑或色斑可接受）。
- 侧光下可见细小面部绒毛；肤色不均匀但干净（真人漂亮皮肤），禁止全脸同一色号的瓷器/蜡像皮。
- 高光只能是皮肤油脂的小范围反光，禁止塑料漆面、禁止美颜 APP、禁止 CG 次表面散射假光滑。
- 仍禁止粗糙问题肌、大面积痘疤堆砌、油光满面。`.trim();

/** edit 时借实拍图只偷皮肤/光感，禁止粘脸（女主 / 旧口径） */
export const PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH = `【实拍软参考·只借皮肤与光感】
- 参考图仅提供：东亚真人皮肤质感、毛孔密度、自然光下的血色与成熟气场。
- 禁止复制参考图五官比例、发际线、耳形、痣位；禁止输出与参考图同一张脸。
- 不同角色名必须并排放仍能一眼区分。`.trim();

/**
 * 男主实拍锚（收束口径）：只调皮肤质感与五官轮廓，不整容成网红美男。
 * 第一张=库图构图/服装底；其后实拍=皮肤+轮廓参考。
 */
export const PHOTOREAL_FACE_LOCK_BLEND_ZH = `【实拍锚·皮肤与五官轮廓】
- 实拍参考只用于：皮肤毛孔/血色质感，以及眉眼鼻唇下颌的大轮廓气质；可保留同源辨识度。
- 不要整容成帅哥模板：禁止网红锥子脸、过度立体修容、美颜磨皮、统一小V下巴。
- 允许：普通东亚成年男性长相、轻微皱纹/眼袋、自然不对称；发型服装跟库图角色，不必西装复制参考图。
- 骨相轮盘只做下颌宽度微调，仍须像「同一生活圈的真人」，禁止换成名人脸。`.trim();

/** 禁止全员帅哥美女 */
export const PHOTOREAL_ANTI_BEAUTY_FILTER_ZH = `【去美颜·生活感】
- 禁止全员帅哥美女、网红脸、偶像脸、过度对称整容感。
- 允许普通五官、岁月痕迹（法令纹/眼袋/抬头纹视年龄）、真实肤色不均。
- 气质跟角色身份，不靠美颜滤镜撑场面。`.trim();

/** 老人槽硬块 */
export const PHOTOREAL_ELDER_CAST_ZH = `【年龄段·老人配角/长辈】
- 东亚约 60–75 岁，生活感长辈，不是明星扮老。
- 可见花白发或灰白发、法令纹、眼袋、颈纹；体态自然，得体日常服装。
- 禁止童颜滤镜、禁止过度丰唇大眼网红妆、禁止暴露服装。`.trim();

/**
 * 剧用儿童硬块（8–12 岁家庭向短剧配角；过审正向表述，避免负向敏感词触发）。
 */
export const PHOTOREAL_CHILD_CAST_ZH = `【年龄段·剧用儿童·家庭向】
- 东亚约 8–12 岁小学生角色设定卡，短剧家庭/校园配角；学龄儿童气质，不是婴幼儿。
- 穿完整校服或日常厚外套+长裤/长裙，肩臂腿均被衣物覆盖；表情自然开朗，素颜。
- 构图：证件照/年册式半身肖像或全身设定卡；干净背景；G 级全家宜；无成人妆容。`.trim();

export function photorealLifeStagePromptBlock(
  lifeStage: "child" | "adult" | "elder" | undefined,
): string {
  if (lifeStage === "elder") return PHOTOREAL_ELDER_CAST_ZH;
  if (lifeStage === "child") return PHOTOREAL_CHILD_CAST_ZH;
  return "";
}

/** 中文硬锁：皮肤真实度 + 轻微不对称 + 禁塑料脸 */
export const PHOTOREAL_ANTI_AI_LOCK_ZH = `【去 AI 味·超写实人像硬锁】
${PHOTOREAL_SKIN_TEXTURE_LOCK_ZH}
${PHOTOREAL_ANTI_BEAUTY_FILTER_ZH}
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
