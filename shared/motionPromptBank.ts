/**
 * 短视频包装动效库（Logo / 产品广告 / 数据动画 / 字幕动效）。
 * 结构借鉴公开「动效 prompt 库」分类法；成稿只写手法词，不出现外部仓库名 / 渲染栈名。
 * 主消费：/canvas 成片包装；Platform 不单独维护副本。
 * 来源抽帧参考：Downloads/2026Jul17/pr.mp4
 */

export type MotionPromptCategory = "logo" | "product_ad" | "data" | "caption" | "scene_steal";

export const MOTION_PROMPT_CATEGORY_LABEL_ZH: Record<MotionPromptCategory, string> = {
  logo: "Logo 动画",
  product_ad: "产品广告",
  data: "数据动画",
  caption: "字幕动效",
  scene_steal: "电影抢镜",
};

export type MotionPromptEntry = {
  id: string;
  category: MotionPromptCategory;
  no: number;
  nameZh: string;
  /** 交付效果一句 */
  effectZh: string;
  /** 何时用 */
  whenToUseZh: string;
  /** 注入生成/施工的手法摘要（可占位，非整段外仓原文） */
  craftSummaryZh: string;
  /** 画幅建议 */
  aspectHint: "9:16" | "16:9" | "either";
};

export const MOTION_PROMPT_BANK: readonly MotionPromptEntry[] = [
  // —— Logo ×8 ——
  {
    id: "logo_01_stroke_glow",
    category: "logo",
    no: 1,
    nameZh: "描边发光亮起",
    effectZh: "线条光笔描画点亮 Logo，光斑沿轮廓奔跑后字标升起。",
    whenToUseZh: "品牌开场、片头落版。",
    craftSummaryZh: "描边路径 + 发光；先线后填；落版轻上移；确定性时间轴无随机。",
    aspectHint: "either",
  },
  {
    id: "logo_02_giant_hammer",
    category: "logo",
    no: 2,
    nameZh: "巨字重锤字标",
    effectZh: "品牌词一记硬砸入场，落地后微呼吸。",
    whenToUseZh: "强势品牌声明、广告中段冲击。",
    craftSummaryZh: "超大字重；快落缓震；落地后 2% 呼吸缩放；全片仅用一次。",
    aspectHint: "either",
  },
  {
    id: "logo_03_rgb_flash",
    category: "logo",
    no: 3,
    nameZh: "RGB 色散快闪",
    effectZh: "红绿蓝色散抖动后「卡」地锁定一字签名。",
    whenToUseZh: "科技 / 电竞 / 故障美学开场。",
    craftSummaryZh: "硬切勿淡入；大→小→锁；hold 时 1 帧残影保活；全片最多一次。",
    aspectHint: "either",
  },
  {
    id: "logo_04_liquid_merge",
    category: "logo",
    no: 4,
    nameZh: "液态融合 Logo",
    effectZh: "液滴游动融合成一个整体 Logo。",
    whenToUseZh: "美妆、饮料、流体品牌。",
    craftSummaryZh: "流体形变；融合后边缘收干净；避免脏边。",
    aspectHint: "either",
  },
  {
    id: "logo_05_particle_form",
    category: "logo",
    no: 5,
    nameZh: "粒子聚形 Logo",
    effectZh: "细粒子汇聚成字标。",
    whenToUseZh: "科技感 / 魔法感品牌。",
    craftSummaryZh: "外→内汇聚；成型后粒子静止；禁止持续噪声抖动。",
    aspectHint: "either",
  },
  {
    id: "logo_06_liquid_fill",
    category: "logo",
    no: 6,
    nameZh: "液体灌注 Logo",
    effectZh: "发光液体灌满空心字标。",
    whenToUseZh: "能量饮、金融「充值」隐喻。",
    craftSummaryZh: "自下而上灌注；液面微晃；满后收光。",
    aspectHint: "either",
  },
  {
    id: "logo_07_3d_spin",
    category: "logo",
    no: 7,
    nameZh: "3D 立体旋转",
    effectZh: "立体字标旋转亮相后正面锁定。",
    whenToUseZh: "立体品牌、游戏化产品。",
    craftSummaryZh: "单轴旋转进正面；结束必须正对镜头；材质简洁。",
    aspectHint: "either",
  },
  {
    id: "logo_08_neon_on",
    category: "logo",
    no: 8,
    nameZh: "霓虹点亮",
    effectZh: "霓虹灯管闪烁后稳定点亮字标。",
    whenToUseZh: "夜店、夜景、潮流品牌。",
    craftSummaryZh: "闪 2–3 次后稳态；外发光克制；勿全片闪烁。",
    aspectHint: "either",
  },

  // —— 产品广告 ×7 ——
  {
    id: "product_01_app_demo",
    category: "product_ad",
    no: 1,
    nameZh: "手机 App 演示",
    effectZh: "干净手机 mockup 展示界面流转。",
    whenToUseZh: "App / SaaS 功能介绍。",
    craftSummaryZh: "竖屏手机框；界面切换硬切或轻推；背景纯净。",
    aspectHint: "9:16",
  },
  {
    id: "product_02_feature_callouts",
    category: "product_ad",
    no: 2,
    nameZh: "产品特性标注",
    effectZh: "暗场聚光产品，细线标注材质/卖点。",
    whenToUseZh: "硬件、配件、卖点拆解。",
    craftSummaryZh: "中心产品；引线+标签依次亮起；工程感构图。",
    aspectHint: "either",
  },
  {
    id: "product_03_before_after",
    category: "product_ad",
    no: 3,
    nameZh: "Before/After 对比推移",
    effectZh: "竖向或横向滑杆揭示前后对比。",
    whenToUseZh: "效果类、改造类、护肤。",
    craftSummaryZh: "滑杆一次扫过；前后画面锁定同一构图。",
    aspectHint: "either",
  },
  {
    id: "product_04_cta_endcard",
    category: "product_ad",
    no: 4,
    nameZh: "结尾 CTA 卡",
    effectZh: "暗底品牌字 + 一句行动号召收束。",
    whenToUseZh: "广告尾板、转化收口。",
    craftSummaryZh: "大字少字；停留 ≥1.2s；无杂讯。",
    aspectHint: "either",
  },
  {
    id: "product_05_exploded_view",
    category: "product_ad",
    no: 5,
    nameZh: "爆炸拆解",
    effectZh: "零件沿轴炸开悬停并标材质，再严丝合缝复原。",
    whenToUseZh: "硬件内部构造、工程感种草。",
    craftSummaryZh: "3–5 层零件；轴向分离→标注→统一复原；阴影一致。",
    aspectHint: "9:16",
  },
  {
    id: "product_06_social_proof",
    category: "product_ad",
    no: 6,
    nameZh: "好评口碑",
    effectZh: "评分与评价条以卡片动效亮相。",
    whenToUseZh: "信任背书、评分展示。",
    craftSummaryZh: "大数字评分先入；评价条错落入场；勿堆过多卡。",
    aspectHint: "either",
  },
  {
    id: "product_07_price_drop",
    category: "product_ad",
    no: 7,
    nameZh: "降价爆点",
    effectZh: "高对比价签砸入，制造紧迫感。",
    whenToUseZh: "促销、限时价。",
    craftSummaryZh: "价格字最大；红/蓝高对比；全片一次砸入即可。",
    aspectHint: "either",
  },

  // —— 数据动画 ×7 ——
  {
    id: "data_01_dashboard",
    category: "data",
    no: 1,
    nameZh: "数据战报仪表盘",
    effectZh: "大数字滚动 + 迷你柱图组成战报卡。",
    whenToUseZh: "增长汇报、经营战报。",
    craftSummaryZh: "数字滚动收束到目标值；副图表同步生长。",
    aspectHint: "either",
  },
  {
    id: "data_02_bar_grow",
    category: "data",
    no: 2,
    nameZh: "柱状图生长",
    effectZh: "柱条自下向上生长并标百分比。",
    whenToUseZh: "对比多项指标。",
    craftSummaryZh: "错峰生长；最高柱最后到位；标签清晰。",
    aspectHint: "either",
  },
  {
    id: "data_03_line_draw",
    category: "data",
    no: 3,
    nameZh: "折线描画+标注",
    effectZh: "折线描出趋势并点亮终点标注。",
    whenToUseZh: "走势、转化漏斗外的趋势叙事。",
    craftSummaryZh: "路径描画；终点圆点+短注；背景留白。",
    aspectHint: "either",
  },
  {
    id: "data_04_donut",
    category: "data",
    no: 4,
    nameZh: "环形图扫入",
    effectZh: "环形占比扫入，中心放大数字。",
    whenToUseZh: "占比、完成率。",
    craftSummaryZh: "单环主扫；中心数字后亮；图例克制。",
    aspectHint: "either",
  },
  {
    id: "data_05_icon_array",
    category: "data",
    no: 5,
    nameZh: "图标阵列占比",
    effectZh: "人型/图标阵列点亮表达占比（如 7/10）。",
    whenToUseZh: "人群占比、调研结果。",
    craftSummaryZh: "先灰后亮；比例一眼可读；避免花哨。",
    aspectHint: "either",
  },
  {
    id: "data_06_bar_race",
    category: "data",
    no: 6,
    nameZh: "横向条形竞速榜",
    effectZh: "横条竞速显示排名变化。",
    whenToUseZh: "排行、赛马叙事。",
    craftSummaryZh: "条长变化同步；排名数字锁定；暗底更清晰。",
    aspectHint: "either",
  },
  {
    id: "data_07_timeline",
    category: "data",
    no: 7,
    nameZh: "时间线里程碑",
    effectZh: "纵向时间线点亮关键里程碑节点。",
    whenToUseZh: "历程、90 天计划、版本节点。",
    craftSummaryZh: "节点依次亮；当前节点放大；文案短。",
    aspectHint: "9:16",
  },

  // —— 字幕动效 ×12（代表性条目；与片中 12 式对齐）——
  {
    id: "caption_01_giant_hammer",
    category: "caption",
    no: 1,
    nameZh: "巨字重锤",
    effectZh: "关键词超大字砸入画面，人像前或后分层。",
    whenToUseZh: "口播结论句、金句。",
    craftSummaryZh: "全片 1 次；字在人后或人侧；避免挡脸关键五官。",
    aspectHint: "9:16",
  },
  {
    id: "caption_02_karaoke",
    category: "caption",
    no: 2,
    nameZh: "逐字卡拉OK",
    effectZh: "字幕随声逐字高亮。",
    whenToUseZh: "口播跟读、歌词感。",
    craftSummaryZh: "对齐 VO 时间戳；高亮色单一；底部安全区。",
    aspectHint: "9:16",
  },
  {
    id: "caption_03_behind_person",
    category: "caption",
    no: 3,
    nameZh: "人后穿字",
    effectZh: "大字穿在人物身后，主体抠像压住下弧文字。",
    whenToUseZh: "氛围金句、神秘感。",
    craftSummaryZh: "需主体抠像层；下弧字在人后；上弧在人前。",
    aspectHint: "9:16",
  },
  {
    id: "caption_04_rgb_glitch",
    category: "caption",
    no: 4,
    nameZh: "RGB 故障字",
    effectZh: "故障色散字幕硬切出现。",
    whenToUseZh: "冲突句、系统崩了感。",
    craftSummaryZh: "Cut never fade；全片最多 1 次故障字幕。",
    aspectHint: "9:16",
  },
  {
    id: "caption_05_handwrite_jitter",
    category: "caption",
    no: 5,
    nameZh: "手写渐振叠字",
    effectZh: "手写体叠字轻微抖动强调态度。",
    whenToUseZh: "态度句、反鸡汤。",
    craftSummaryZh: "抖动幅度克制；2–4 次即可。",
    aspectHint: "9:16",
  },
  {
    id: "caption_06_interlock_blocks",
    category: "caption",
    no: 6,
    nameZh: "咬合字块",
    effectZh: "大小字块咬合成一句结构化标题。",
    whenToUseZh: "问题句、结构说明。",
    craftSummaryZh: "字重对比；咬合一组后静止。",
    aspectHint: "9:16",
  },
  {
    id: "caption_07_mystery_giant",
    category: "caption",
    no: 7,
    nameZh: "神秘巨字",
    effectZh: "半透明巨字沉在背景缓慢显形。",
    whenToUseZh: "悬念、氛围铺垫。",
    craftSummaryZh: "透明度缓升；不抢主体脸。",
    aspectHint: "9:16",
  },
  {
    id: "caption_08_scatter_fill",
    category: "caption",
    no: 8,
    nameZh: "大字铺满",
    effectZh: "关键词撒满画面形成氛围墙。",
    whenToUseZh: "情绪高潮、口号墙。",
    craftSummaryZh: "密度可控；中心留主体；全片 1 组。",
    aspectHint: "9:16",
  },
  {
    id: "caption_09_word_halo",
    category: "caption",
    no: 9,
    nameZh: "词环头顶",
    effectZh: "一句拆成词沿椭圆环绕头顶，下弧隐入肩后，整体微呼吸。",
    whenToUseZh: "思考态、灵感态口播。",
    craftSummaryZh: "先测头围；词保持水平；下弧后人；环整体 sine 呼吸。",
    aspectHint: "9:16",
  },
  {
    id: "caption_10_type_pop",
    category: "caption",
    no: 10,
    nameZh: "弹跳入句",
    effectZh: "关键词弹跳落入句子位置。",
    whenToUseZh: "轻松口播、种草。",
    craftSummaryZh: "弹跳衰减快；落地无持续弹。",
    aspectHint: "9:16",
  },
  {
    id: "caption_11_mask_wipe",
    category: "caption",
    no: 11,
    nameZh: "遮罩擦除显字",
    effectZh: "遮罩擦过显出整句字幕。",
    whenToUseZh: "揭晓句、反转句。",
    craftSummaryZh: "单向擦除；结束干净；勿来回擦。",
    aspectHint: "9:16",
  },
  {
    id: "caption_12_stack_rise",
    category: "caption",
    no: 12,
    nameZh: "叠层升起",
    effectZh: "多层字幕自下叠升成信息层。",
    whenToUseZh: "列举三点、步骤感。",
    craftSummaryZh: "最多 3 层；层间距固定；收束对齐。",
    aspectHint: "9:16",
  },
  // —— 电影抢镜 ×3（HB V5）——
  {
    id: "steal_01_titanic_bow",
    category: "scene_steal",
    no: 1,
    nameZh: "泰坦尼克船头抢镜",
    effectZh: "浪漫张臂名场面被真人突然闯入搅局，再霸气占位重摆姿势。",
    whenToUseZh: "穿越漫剧、黑色幽默短视频、真人融入经典场面。",
    craftSummaryZh:
      "广角船头金色黄昏；@人物照片从右侧突兀闯入，夸张黑色幽默推开女主（勿血腥），再自信重摆张臂姿势；原男主背景惊慌。闯入微晃、落姿稳定。",
    aspectHint: "either",
  },
  {
    id: "steal_02_rain_kiss_interrupt",
    category: "scene_steal",
    no: 2,
    nameZh: "雨中倒挂亲吻抢镜",
    effectZh: "雨夜名场面即将亲吻时，真人推开女主并上前完成夸张电影吻。",
    whenToUseZh: "超级英雄梗、雨夜情绪片、穿越抢戏。",
    craftSummaryZh:
      "锁雨夜倒挂英雄首帧；@人物照片锁脸从右侧入画轻推女主，扶面罩完成雨中吻；保留真实五官勿过度美颜。",
    aspectHint: "either",
  },
  {
    id: "steal_03_portal_cross",
    category: "scene_steal",
    no: 3,
    nameZh: "时空门丝滑穿越",
    effectZh: "真人从裂隙一侧丝滑踏入异世界，前后光影连续。",
    whenToUseZh: "穿越漫剧开场、异世界落地、特效转场。",
    craftSummaryZh:
      "@人物照片从时空裂隙踏出，步伐与粒子连贯；落地轻推镜锁脸；禁止脸崩与瞬移闪现。",
    aspectHint: "9:16",
  },
] as const;

export function listMotionPromptsByCategory(category: MotionPromptCategory): MotionPromptEntry[] {
  return MOTION_PROMPT_BANK.filter((e) => e.category === category);
}

export function getMotionPromptById(id: string): MotionPromptEntry | null {
  const key = String(id || "").trim();
  return MOTION_PROMPT_BANK.find((e) => e.id === key) || null;
}

const TOPIC_MOTION_HINTS: Array<{ keys: string[]; preferIds: string[] }> = [
  { keys: ["电竞", "故障", "RGB", "赛博"], preferIds: ["logo_03_rgb_flash", "logo_01_stroke_glow"] },
  { keys: ["Logo", "logo", "品牌", "片头", "落版", "字标", "开场动画"], preferIds: ["logo_01_stroke_glow", "logo_02_giant_hammer"] },
  { keys: ["美妆", "饮料", "流体", "液体"], preferIds: ["logo_04_liquid_merge", "logo_06_liquid_fill"] },
  { keys: ["产品", "种草", "拆解", "开箱", "爆炸图", "展示"], preferIds: ["product_05_exploded_view", "product_01_app_demo"] },
  { keys: ["App", "APP", "界面", "演示", "UI"], preferIds: ["product_01_app_demo", "product_05_exploded_view"] },
  { keys: ["数据", "增长", "报表", "图表", "看板", "KPI", "指标"], preferIds: ["data_01_dashboard", "data_06_bar_race"] },
  { keys: ["赛跑", "排名", "柱状"], preferIds: ["data_06_bar_race", "data_01_dashboard"] },
  { keys: ["揭晓", "反转句", "擦除"], preferIds: ["caption_11_mask_wipe", "caption_07_mystery_giant"] },
  { keys: ["列举", "三点", "步骤"], preferIds: ["caption_12_stack_rise", "caption_06_interlock_blocks"] },
  { keys: ["字幕", "口播", "大字", "标题", "花字", "弹幕感"], preferIds: ["caption_09_word_halo", "caption_01_giant_hammer"] },
  { keys: ["抢镜", "穿越", "名场面", "泰坦尼克", "闯入"], preferIds: ["steal_01_titanic_bow", "steal_03_portal_cross"] },
];

export type MotionPromptRecommendResult = {
  motionId: string | null;
  entry?: MotionPromptEntry | null;
  reasonZh: string;
};

/** 题材 → 可选包装动效 1 条（默认不强制；UI 可自动建议） */
export function recommendMotionPromptFromTopic(topic?: string): MotionPromptRecommendResult {
  const t = String(topic || "").trim();
  if (!t) {
    return { motionId: null, entry: null, reasonZh: "未填题材时不强制包装动效（可选手选）" };
  }
  for (const hint of TOPIC_MOTION_HINTS) {
    if (!hint.keys.some((k) => t.includes(k))) continue;
    for (const id of hint.preferIds) {
      const entry = getMotionPromptById(id);
      if (!entry) continue;
      const hit = hint.keys.find((k) => t.includes(k)) || hint.keys[0];
      return {
        motionId: entry.id,
        entry,
        reasonZh: `题材含「${hit}」→ 建议「${entry.nameZh}」`,
      };
    }
  }
  return { motionId: null, entry: null, reasonZh: "题材未命中包装类关键词（可选手选）" };
}

/** 注入成片/包装节点的手法块 */
export function buildMotionPromptInjectBlock(ids: string[]): string {
  const picked = ids.map(getMotionPromptById).filter(Boolean) as MotionPromptEntry[];
  if (!picked.length) return "";
  const lines = picked.map((e, i) => {
    const cat = MOTION_PROMPT_CATEGORY_LABEL_ZH[e.category];
    return `${i + 1}. [${cat}] ${e.nameZh}\n效果：${e.effectZh}\n用法：${e.whenToUseZh}\n手法：${e.craftSummaryZh}`;
  });
  return `【包装动效手法】\n${lines.join("\n")}\n成稿只写手法词；禁止外部仓库名、渲染栈名、创作者网名。`;
}
