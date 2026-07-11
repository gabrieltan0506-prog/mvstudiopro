/**
 * 分镜灯光 / 情绪 / 运镜：可迁移拍摄手法库。
 * 口径（用户选定 A+B+C）：
 * - A 成稿完全去名（禁止致敬/导演名/片名/「某某风」）
 * - B 对外只写手法词（灯光·运镜·情绪·文案节奏）
 * - C 系统 Prompt 可点名作手法溯源参考，但模型输出必须洗掉
 * 曹译文 = 内地剧集导演（如《藏海传》系手法），非港影同名。
 */

export type CraftMedium = "film" | "tv" | "film_tv";

export type CraftTechniqueProfile = {
  id: string;
  /** 系统 Prompt 溯源用（C）；禁止写入用户可见成稿（A/B） */
  sourceLabel: string;
  /** 给人看的溯源短名，仅出现在系统参考段 */
  sourceRefZh: string;
  medium: CraftMedium;
  /** 可直接写进分镜的灯光手法 */
  lightingZh: string;
  /** 可直接写进分镜的情绪/表演调度 */
  emotionZh: string;
  /** 可直接写进分镜的运镜/剪辑节奏 */
  cameraZh: string;
  /** 可迁移到钩子/口播的文案节奏感（不点名来源） */
  copyRhythmZh: string;
  lightingEn: string;
  emotionEn: string;
  cameraEn: string;
  /**
   * 创意母题：气氛/关系/节奏，改写进用户场景。
   * 括号内片名仅供内部理解，禁止出现在成稿。
   */
  creativeMotifsZh: string[];
};

/** 中文主体内：六栏表字段 */
export const STORYBOARD_PANEL_TABLE_FIELDS_ZH =
  "景别 / 运镜 / 灯光安排 / 情绪表达 / 画面内容 / 台词与音效";

/** 英文像素锁用字段名 */
export const STORYBOARD_PANEL_TABLE_FIELDS_EN =
  "**景别**, **运镜**, **灯光安排**, **情绪表达**, **画面内容**, **台词与音效**";

/**
 * 拍摄手法参考卡（电影 + 电视剧）。
 * 只借灯光、运镜、情绪调度与文案节奏；不是致敬清单。
 */
export const CRAFT_TECHNIQUE_PROFILES: readonly CraftTechniqueProfile[] = [
  {
    id: "architectural_contrast",
    sourceLabel: "internal:nolan-craft",
    sourceRefZh: "Christopher Nolan（电影）",
    medium: "film",
    lightingZh:
      "大画幅质感、高反差明暗、实用光与建筑空间塑形；冷暖对切服务时间/记忆张力；少用廉价柔光糊脸",
    emotionZh: "克制、压迫、智性悬疑；情绪靠空间与节奏累积，少夸张表演",
    cameraZh: "稳、沉、几何构图；缓慢推进或固定长镜制造压迫",
    copyRhythmZh: "先给信息缺口，再层层揭开；短句抛问，长句收束逻辑",
    lightingEn:
      "large-format clarity, high-contrast practicals, architectural light; cool/warm cuts for temporal tension",
    emotionEn: "restrained intellectual dread via space and rhythm",
    cameraEn: "stable geometric frames; slow push or locked-off long takes",
    creativeMotifsZh: [
      "时间/节律错位带来的身心疑问（改写进用户生活场域）",
      "建筑/室内纵深制造抉择压力",
    ],
  },
  {
    id: "warm_wonder",
    sourceLabel: "internal:spielberg-craft",
    sourceRefZh: "Steven Spielberg（电影）",
    medium: "film",
    lightingZh:
      "温暖主光与轮廓光、魔术时刻金晖、体积光/尘雾光束；面部始终可读",
    emotionZh: "好奇、敬畏、亲情与发现；镜头邀请观众一起看见",
    cameraZh: "略低机位仰望、柔和跟拍；发现瞬间给反应镜头",
    copyRhythmZh: "口语化惊奇开场 → 共情故事 → 温暖收束邀请",
    lightingEn:
      "warm key + rim, magic-hour glow, volumetric rays; faces always readable",
    emotionEn: "wonder, awe, familial warmth",
    cameraEn: "slight low-angle wonder; soft follow; reaction beats on discovery",
    creativeMotifsZh: [
      "第一人称「看见」的惊奇",
      "危机中仍托住人性的温暖轮廓光",
    ],
  },
  {
    id: "mystery_reveal",
    sourceLabel: "internal:abrams-craft",
    sourceRefZh: "J.J. Abrams（电影/剧集）",
    medium: "film_tv",
    lightingZh:
      "镜头光晕、高对比剪影、霓虹与实用光点缀；暗部保留细节",
    emotionZh: "神秘、期待、突然揭示；情绪随信息缺口拉扯",
    cameraZh: "快速切入细节特写再拉开全景；揭示前留半拍静默",
    copyRhythmZh: "悬念钩子 → 延迟答案 → 一句话揭底",
    lightingEn:
      "lens flares, silhouette contrast, neon/practical sparkles; retain shadow detail",
    emotionEn: "mystery, anticipation, reveal",
    cameraEn: "detail insert then wide pull-back; half-beat silence before reveal",
    creativeMotifsZh: [
      "先给缺口再给答案的谜箱节奏",
      "剪影+光点制造期待感",
    ],
  },
  {
    id: "industrial_world",
    sourceLabel: "internal:ridley-scott-craft",
    sourceRefZh: "Ridley Scott（电影）",
    medium: "film",
    lightingZh:
      "工业冷光与烟雾体积感、高对比轮廓、雨夜霓虹/舱体实用光；世界感先于人物",
    emotionZh: "疏离中的生存意志、史诗冷峻；情绪藏在环境压迫里",
    cameraZh: "广角建立世界，再切入人物；缓慢横移扫过环境细节",
    copyRhythmZh: "先立世界/处境，再落到个人选择；语气冷而有力",
    lightingEn:
      "industrial cold light, volumetric haze, hard rim, rain-neon practicals",
    emotionEn: "alienated will; emotion via environmental pressure",
    cameraEn: "wide world-establish then character; slow lateral environment scan",
    creativeMotifsZh: [
      "都市雾雨中的身份/边界疑问",
      "一束光切开黑暗的密闭空间恐惧",
      "烈日高反差下的尊严与代价",
    ],
  },
  {
    id: "kinetic_ensemble",
    sourceLabel: "internal:justin-lin-craft",
    sourceRefZh: "Justin Lin / 林诣彬（电影）",
    medium: "film",
    lightingZh:
      "高能量运动光影、车灯/城市夜景闪切、动作轴线清晰；亮暗快速切换推节奏",
    emotionZh: "速度感、团队羁绊、群体张力；情绪跟动作同频",
    cameraZh: "跟拍、甩镜、清晰地理轴线；每格写清谁在动、往哪去",
    copyRhythmZh: "短促动词堆叠、口号式金句、群体「我们」感",
    lightingEn:
      "high-energy motion light, headlight/city-night flashes, clear action axis",
    emotionEn: "velocity, loyalty, ensemble tension",
    cameraEn: "tracking, whip-pans, readable geography of motion",
    creativeMotifsZh: [
      "冲刺/节律/团队协作的生活隐喻",
      "动作可读性优先于炫技",
    ],
  },
  {
    id: "minimal_haze",
    sourceLabel: "internal:villeneuve-craft",
    sourceRefZh: "Denis Villeneuve（电影）",
    medium: "film",
    lightingZh:
      "极简大面积光域、雾霾散射、冷灰青调；人物常被环境光吞没又被一束光找回",
    emotionZh: "疏离、庄严、存在主义静默；少台词多气氛",
    cameraZh: "远景压迫、缓慢推轨；尺度差制造敬畏",
    copyRhythmZh: "留白多、句子短；一个意象撑住整段",
    lightingEn:
      "minimalist light fields, haze scatter, cold teal-grey; single beam recovers figure",
    emotionEn: "alienation, solemn quiet",
    cameraEn: "oppressive wides, slow dolly; scale contrast",
    creativeMotifsZh: ["雾中巨物与渺小人类的尺度敬畏"],
  },
  {
    id: "neon_longing",
    sourceLabel: "internal:wong-kar-wai-craft",
    sourceRefZh: "王家卫（电影）",
    medium: "film",
    lightingZh:
      "霓虹色溢、潮湿反射、慢门残影感、暖黄与青绿对撞；近景皮肤纹理与光斑",
    emotionZh: "暧昧、怀旧、欲言又止；时间被拉长的情绪余韵",
    cameraZh: "贴身近景、手持微晃、慢动作余韵",
    copyRhythmZh: "半句停顿、重复意象、说一半留一半",
    lightingEn:
      "neon spill, wet reflections, warm amber vs teal; intimate skin texture",
    emotionEn: "ambiguous longing, nostalgia",
    cameraEn: "intimate close-ups, slight handheld, lingering slow-mo",
    creativeMotifsZh: ["都市身心节奏里的「差一点」与错过"],
  },
  {
    id: "precision_unease",
    sourceLabel: "internal:fincher-craft",
    sourceRefZh: "David Fincher（电影/剧集）",
    medium: "film_tv",
    lightingZh:
      "精密控光、低饱和、顶侧硬光切面、青冷阴影；画面干净如手术刀",
    emotionZh: "偏执、冷静、不安；情绪压在细节与构图里",
    cameraZh: "绝对水平、精确推轨；细节插入放大不安",
    copyRhythmZh: "冷静陈述事实 → 一个反转细节 → 压迫收束",
    lightingEn:
      "precision-controlled, desaturated, hard top-side cuts, cyan-cool shadows",
    emotionEn: "obsessive calm unease",
    cameraEn: "dead-level frames, precise dolly; detail inserts",
    creativeMotifsZh: ["一束顶光切开秘密的细节不安"],
  },
  {
    id: "weather_epic",
    sourceLabel: "internal:kurosawa-craft",
    sourceRefZh: "黑泽明（电影）",
    medium: "film",
    lightingZh: "天气即灯光（风雨尘雾）、深远透视、群像层次光；自然光戏剧化",
    emotionZh: "史诗正义感、人性拉扯、群体情绪浪潮",
    cameraZh: "多机位群像、风雨中横移；天气推动场面",
    copyRhythmZh: "群体声音与个人抉择对撞；语气有分量",
    lightingEn:
      "weather-as-light, deep perspective, layered group lighting",
    emotionEn: "epic moral tension; crowd emotion as wave",
    cameraEn: "multi-angle ensemble; lateral moves through weather",
    creativeMotifsZh: ["风雨中的群体抉择与道德张力"],
  },
  {
    id: "motivated_window",
    sourceLabel: "internal:deakins-craft",
    sourceRefZh: "Roger Deakins（摄影手法）",
    medium: "film",
    lightingZh:
      "自然主义动机光、窗光塑形、柔和衰减、真实空间逻辑；高级但不炫技",
    emotionZh: "诚实、沉静、人物内心可见",
    cameraZh: "克制机位、跟随人物视线；少花哨转场",
    copyRhythmZh: "朴素真话、一句顶一句；不堆形容词",
    lightingEn:
      "motivated naturalistic window light, soft falloff, real-space logic",
    emotionEn: "honest stillness; inner life on face",
    cameraEn: "restrained coverage following eyelines",
    creativeMotifsZh: ["窗光塑形的诚实面孔（动机光始终说得通）"],
  },
  {
    id: "family_longform",
    sourceLabel: "internal:zheng-xiaolong-tv-craft",
    sourceRefZh: "郑晓龙（电视剧）",
    medium: "tv",
    lightingZh:
      "剧集级人物主光稳定、客厅/宅门/宴会层次分明；暖调生活光与冷调冲突光对切；面部优先可读",
    emotionZh: "家庭伦理张力、时代命运感、隐忍与爆发；长叙事里情绪要攒得住、放得开",
    cameraZh: "正反打清晰、席间关系调度；关键句给反应镜头",
    copyRhythmZh: "生活口语里藏刀；关系消长用对话推进，不靠喊口号",
    lightingEn:
      "stable TV face key; layered home/banquet light; warm domestic vs cool conflict",
    emotionEn: "family-ethics tension; restraint then release",
    cameraEn: "clean shot-reverse; table blocking; reaction on key lines",
    creativeMotifsZh: [
      "一桌饭/一场会面里的关系消长",
      "公开场合冷光 vs 私密暖光的情绪对切（改写为当代场域）",
    ],
  },
  {
    id: "legend_restraint",
    sourceLabel: "internal:cao-yiwen-mainland-tv-craft",
    sourceRefZh: "曹译文（内地剧集，如《藏海传》系手法；非港影同名）",
    medium: "tv",
    lightingZh:
      "古装/传奇剧集层次光：日景通透、夜戏烛火与月光动机明确；眼神光稳定，方便长台词与微表情",
    emotionZh: "隐忍、谋略、情感暗涌；连载节奏——每格留「下一拍」",
    cameraZh: "稳镜听戏、微推强调决断；对峙用缓慢环绕或固定对切",
    copyRhythmZh: "话少意多；翻盘前先写「静」与边界感",
    lightingEn:
      "period layered light; motivated candle/moon night; stable eye-light",
    emotionEn: "restraint, strategy, undercurrent; serial next-beat hook",
    cameraEn: "steady coverage for dialogue; micro-push on decisions",
    creativeMotifsZh: [
      "长期主义/边界感/翻盘前的静",
      "暖遇合 vs 冷分离的光线温差",
    ],
  },
] as const;

function mediumLabelZh(m: CraftMedium): string {
  if (m === "tv") return "剧集手法";
  if (m === "film_tv") return "电影/剧集手法";
  return "电影手法";
}

function formatCraftCardsZh(): string {
  return CRAFT_TECHNIQUE_PROFILES.map((d, i) => {
    const motifs = d.creativeMotifsZh.map((m) => `     · ${m}`).join("\n");
    return `${i + 1}. **手法卡 ${d.id}（${mediumLabelZh(d.medium)}）**
   - 灯光：${d.lightingZh}
   - 运镜：${d.cameraZh}
   - 情绪：${d.emotionZh}
   - 文案节奏：${d.copyRhythmZh}
   - 创意母题（改写进用户场景；成稿勿写来源名/片名）：
${motifs}`;
  }).join("\n");
}

function formatCraftCardsEn(): string {
  return CRAFT_TECHNIQUE_PROFILES.map(
    (d) =>
      `- ${d.id} [${d.medium}]: lighting — ${d.lightingEn}; camera — ${d.cameraEn}; emotion — ${d.emotionEn}`,
  ).join("\n");
}

/** C：仅系统 Prompt 可见的溯源名单 */
function formatSystemSourceRefsZh(): string {
  return CRAFT_TECHNIQUE_PROFILES.map(
    (d) => `- 手法卡 ${d.id} ← 参考 ${d.sourceRefZh}`,
  ).join("\n");
}

/**
 * A+B 成稿硬约束 + C 系统可溯源。
 * 用户可见字段（title/hook/copywriting/detailedScript/stepByStepScript/分镜表/画内字）必须去名。
 */
export const CRAFT_BORROW_NOT_HOMAGE_GUIDANCE_ZH = `【拍摄手法借用·成稿去名硬约束·A+B+C】
- **A（成稿硬约束）**：title、hook、copywriting、detailedScript、publishingAdvice、lightingAndCamera、stepByStepScript、分镜表、画内字中，**禁止**出现导演名、摄影指导名、「向某某致敬」、「某某风/味」、电影/剧集片名。
- **B（对外只写手法词）**：只写灯光、运镜、情绪、文案节奏与可拍场景；用用户人设与痛点说话。
- **C（系统可溯源）**：下方「系统溯源参考」可点名，仅供你理解手法来源；**输出时必须洗掉**，改写成手法描述。
- **高度需求**：每条选题主用 1 种手法卡；下一条再换。
- 剧集手法偏长叙事关系与隐忍爆发；电影手法偏单场光影与世界感。

## 系统溯源参考（C·勿写入成稿）
${formatSystemSourceRefsZh()}`;

/**
 * 中文：分镜灯光与情绪高度需求
 */
export const STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH = `【灯光·运镜·情绪·高度需求】
每一格分镜表**强烈建议**写清 **运镜**、**灯光安排** 与 **情绪表达**，目标是专业影视级光影与情绪感染力——不是手机自拍平光。只借手法与创意。

## 高度需求
- **灯光安排**：主光方向/质感、色温冷暖、明暗比、轮廓光/实用光；包括但不限于侧光、逆光、伦勃朗、窗光、体积光、霓虹溢光、魔术时刻、剧集人物主光等，**须服务本格叙事与人物情绪**。
- **运镜**：景别变化、推拉摇移跟、轴线与节奏；写清观众注意力怎么被带走。
- **情绪表达**：微表情、身体张力、气氛关键词；镜头让观众「感到」而非只「看见」。
- **文案节奏**：钩子/口播可借用手法卡的节奏感，但仍用用户人设说话。
- **跨格情绪弧线**：开场→冲突→洞察→收束，光影与情绪同步递进。

## 手法参考卡（电影+剧集；按段落选用；成稿只写手法词）
${formatCraftCardsZh()}

${CRAFT_BORROW_NOT_HOMAGE_GUIDANCE_ZH}

画内表文字宜短（每栏建议≤12–16字）；完整光影与情绪说明写在脚本【灯光机位】【情绪弧线】字段。`;

/** 英文：像素锁后追加（成稿去名） */
export const STORYBOARD_LIGHTING_EMOTION_LOCK_EN = `CINEMATIC CRAFT — LIGHTING, CAMERA, EMOTION (HIGHLY RECOMMENDED; film + TV techniques):
Each panel table should include short Simplified Chinese for **运镜**, **灯光安排**, and **情绪表达** at professional film/TV craft level. Borrow technique only.
HARD OUTPUT RULE: NEVER name directors/DPs, NEVER write homage / "X-style" / movie-TV titles in on-image text or panel cells. System may know source names; user-visible text must be technique words only.
Technique cards (pick per beat):
${formatCraftCardsEn()}
Prefer larger glyphs; keep each cell short (≤12–14 chars).`;

/** 写入 Stage2 / 自定义选题 */
export const STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH = `【灯光·运镜·情绪·文案节奏·高度需求】lightingAndCamera 与 stepByStepScript **强烈建议**写清：主光/色温/明暗比、运镜意图、情绪弧线，以及口播咬字节奏。可借用包括但不限于：建筑高反差与信息缺口、温暖魔术时刻与发现感、光晕剪影与延迟揭示、工业冷光与世界感、运动闪切与群体羁绊、雾霾大光域与静默、霓虹暧昧余韵、精密顶侧冷光与细节不安、天气即光与群像浪潮、动机窗光诚实塑形、剧集家庭伦理长叙事光影、传奇隐忍与连载「下一拍」——按段落选用一种主手法。
${CRAFT_BORROW_NOT_HOMAGE_GUIDANCE_ZH}`;

/** @deprecated 兼容旧名；等同 CRAFT_BORROW_NOT_HOMAGE_GUIDANCE_ZH */
export const DIRECTOR_WORK_MOTIF_FUSION_GUIDANCE_ZH = CRAFT_BORROW_NOT_HOMAGE_GUIDANCE_ZH;

/** @deprecated 兼容旧名 */
export const MASTER_DIRECTOR_LIGHTING_EMOTION_PROFILES = CRAFT_TECHNIQUE_PROFILES;
