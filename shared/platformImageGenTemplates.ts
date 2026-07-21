/**
 * Platform「文生图与海报」模板库。
 * 分类收敛自公开提示词图库常见用途；成稿为可复用占位模板，不整段抄站内 case。
 * 前台零技术泄漏：不出现竞品站名 / 供应商名。
 */

export type PlatformImageGenGroupId =
  | "poster"
  | "product"
  | "brand"
  | "ui"
  | "chart"
  | "photo"
  | "illustration"
  | "character"
  | "food"
  | "space";

export const PLATFORM_IMAGE_GEN_GROUP_ORDER: readonly {
  id: PlatformImageGenGroupId;
  labelZh: string;
}[] = [
  { id: "poster", labelZh: "海报排版" },
  { id: "product", labelZh: "产品电商" },
  { id: "brand", labelZh: "品牌标识" },
  { id: "ui", labelZh: "界面图形" },
  { id: "chart", labelZh: "信息图表" },
  { id: "photo", labelZh: "摄影写实" },
  { id: "illustration", labelZh: "插画立体" },
  { id: "character", labelZh: "角色人物" },
  { id: "food", labelZh: "美食饮品" },
  { id: "space", labelZh: "建筑空间" },
] as const;

export type PlatformImageGenAspectHint =
  | "1:1"
  | "3:4"
  | "4:5"
  | "9:16"
  | "16:9"
  | "2:1";

export type PlatformImageGenTemplate = {
  id: string;
  group: PlatformImageGenGroupId;
  labelZh: string;
  blurbZh: string;
  /** 能做什么：一句话用途，Picker 主展示 */
  capabilityZh: string;
  needsReference: boolean;
  aspectHint: PlatformImageGenAspectHint;
  promptZh: string;
  promptEn?: string;
};

export const PLATFORM_IMAGE_GEN_TEMPLATES: readonly PlatformImageGenTemplate[] = [
  // —— 海报排版 ——
  {
    id: "pig_city_type_poster",
    group: "poster",
    labelZh: "城市名地标海报",
    blurbZh: "大字即构图 · 地标缝进字形",
    capabilityZh: "做城市名旅行海报：城市名大字占满画面，地标无缝嵌进字母",
    needsReference: false,
    aspectHint: "4:5",
    promptZh:
      "干净现代的排版旅行海报。[城市名] 以粗黑体大写无衬线横贯画面宽度，字母内部或负空间无缝融入该城市地标剪影与天际线。留白克制，主色从城市气质提取；底部一行小字 [国家/一句旅行短句]。禁止杂乱贴纸、水印、多余 UI。比例 4:5。",
  },
  {
    id: "pig_neon_designer_poster",
    group: "poster",
    labelZh: "霓虹创作者海报",
    blurbZh: "3D 角色居中 · 未来工作室",
    capabilityZh: "做霓虹蓝调创作者/活动海报：中心人物 + 工作室光效 + 大标题区",
    needsReference: false,
    aspectHint: "3:4",
    promptZh:
      "超细节 3D 风格创作者海报：年轻数字创作者自信站在画面中央，未来感蓝色霓虹工作室；oversized 街头穿搭，肩背轻微轮廓光。顶部大标题区写 [活动名/主题]，底部小字 [日期或一句 Slogan]。高对比霓虹、干净透视、商业海报级完成度。比例 3:4。禁止水印与多余边框。",
  },
  {
    id: "pig_soft_cutout_cover",
    group: "poster",
    labelZh: "清爽裁切图文封面",
    blurbZh: "色场 + 局部人像 + 手写标题",
    capabilityZh: "做明亮图文封面：大色场托底、底部大胆裁切主体、顶部手写感标题",
    needsReference: true,
    aspectHint: "3:4",
    promptZh:
      "基于参考图生成明亮清爽图文封面：大面积高明度纯净色场背景，平整通风无复杂景深。主体自画面底部大胆裁切进入，只保留最有记忆点的局部。主体上方可叠一个极简圆润小符号。顶部大号手写感标题 [标题文案]，字距松、笔画柔软；中部可一行副标题 [副文案]。文字是主动角色但不遮挡五官。比例 3:4。禁止水印、设定卡多格。",
  },
  {
    id: "pig_mono_watercolor_travel",
    group: "poster",
    labelZh: "单色水彩旅行海报",
    blurbZh: "复古水彩 · 细线墨迹",
    capabilityZh: "做复古单色水彩旅行海报：城市剪影 + 细墨线 + 优雅留白",
    needsReference: false,
    aspectHint: "4:5",
    promptZh:
      "极简复古水彩旅行海报：[城市名]，[国家]。整幅仅用优雅单色 [主色] 水彩与细墨线表现地标、街道与天空层次。竖幅 4:5，上方或下方留标题区写城市名。禁止照片写实、霓虹、贴纸拼贴、水印。",
  },

  // —— 产品电商 ——
  {
    id: "pig_product_hero_still",
    group: "product",
    labelZh: "电商主图静物",
    blurbZh: "干净台面 · 商业打光",
    capabilityZh: "做出电商主图：产品居中、台面干净、广告级打光与材质可读",
    needsReference: false,
    aspectHint: "1:1",
    promptZh:
      "高端电商主图静物：[产品名/简述]。产品居中占画面约 60%，材质纹理清晰（金属/塑料/织物按真实物理），柔和棚拍主光 + 轻轮廓光，浅景深背景虚化或纯净渐变。可留底部一行小字卖点 [卖点一句]。正方形 1:1。禁止杂乱道具墙、可读水印、虚假 Logo 乱堆。",
  },
  {
    id: "pig_cutaway_miniature",
    group: "product",
    labelZh: "剖面微缩世界",
    blurbZh: "巨型容器切开 · 内部微缩场景",
    capabilityZh: "做剖面微缩广告图：巨型食物/产品切开，内部是完整微缩营业场景",
    needsReference: false,
    aspectHint: "16:9",
    promptZh:
      "超写实 3D 微缩剖面：以巨型 [容器物，如汉堡/咖啡罐] 作为建筑外壳，横切/半剖露出内部高度细节的微缩 [场景类型，如餐厅]。内部有工作人员与顾客活动；品牌感元素克制点缀 [品牌名]。宏观食物纹理与微观室内材质并存；商业广告光：暖内冷外、体积光与轻雾。略侧英雄机位，干净虚化背景。比例 16:9。禁止水印。",
  },

  // —— 品牌标识 ——
  {
    id: "pig_app_icon_squircle",
    group: "brand",
    labelZh: "拟物 App 图标",
    blurbZh: "圆角方标 · 白底居中",
    capabilityZh: "做桌面 App 图标：白底圆角方标、单一主体、拟物或轻立体",
    needsReference: false,
    aspectHint: "1:1",
    promptZh:
      "桌面应用图标设计：应用名 [App 名]。单一圆角方（squircle）图标居中于白色画布，约占 80% 画幅，圆角连续平滑。主体为 [图标主体描述]，轻拟物、现代、可读。禁止复杂背景、小字说明书、多图标拼贴、水印。比例 1:1。",
  },
  {
    id: "pig_material_logo_grid",
    group: "brand",
    labelZh: "材质 Logo 六宫格",
    blurbZh: "同一 Logo · 六种材质演绎",
    capabilityZh: "做品牌材质演绎宫格：同一标志用六种材质重塑，适合提案板",
    needsReference: false,
    aspectHint: "1:1",
    promptZh:
      "高级 3×2 宫格拼贴：同一品牌标志 [品牌名/简标描述] 分别用六种材质重塑（如水、玻璃、金属拉丝、陶瓷、织物、霓虹）。每格标志悬浮于简洁场景，天空或纯净背景统一。整体提案板气质，宫格分割干净。比例 1:1。禁止乱码假字、水印。",
  },

  // —— 界面图形 ——
  {
    id: "pig_dashboard_ui_concept",
    group: "ui",
    labelZh: "仪表盘 UI 概念",
    blurbZh: "高保真界面 · 数据卡片",
    capabilityZh: "做产品仪表盘概念图：侧栏+卡片+图表，适合方案示意",
    needsReference: false,
    aspectHint: "16:9",
    promptZh:
      "高保真产品仪表盘 UI 概念稿，主题 [产品领域]。深色或浅色现代界面：左侧导航、顶部筛选、中央数据卡片与折线/柱状图、右侧明细列表。字体层级清晰但勿塞入真实隐私数据；用占位数字与中性标签。桌面 16:9，圆角卡片、细分割线、克制阴影。禁止照片拼贴、水印、杂乱贴纸。",
  },
  {
    id: "pig_mobile_app_screen",
    group: "ui",
    labelZh: "手机 App 界面",
    blurbZh: "竖屏界面 · 组件完整",
    capabilityZh: "做手机 App 单屏概念：状态栏到主按钮完整，适合功能示意",
    needsReference: false,
    aspectHint: "9:16",
    promptZh:
      "精致手机 App 单屏界面概念，功能 [功能简述]。竖屏 9:16，含状态栏、导航标题、主内容区（列表或卡片）、底部主按钮 [按钮文案]。现代圆角组件、清晰间距、品牌主色 [主色]。界面文字用简短中文占位，禁止真实隐私信息与水印。",
  },

  // —— 信息图表 ——
  {
    id: "pig_engineering_infographic",
    group: "chart",
    labelZh: "工程拆解信息图",
    blurbZh: "中心产品 · 标注爆炸",
    capabilityZh: "做工程拆解信息图：中心产品+环形标注，适合科普单图",
    needsReference: false,
    aspectHint: "1:1",
    promptZh:
      "高级正方形工程/科普信息图：中心为 [产品或载具名] 的清晰立体示意，周围环形标注 4–6 个关键模块（中文短标签 + 细指引线）。版式像精装手册单页，留白充足，配色专业克制。禁止照片杂讯、水印、过密小字墙。比例 1:1。",
  },
  {
    id: "pig_process_timeline_poster",
    group: "chart",
    labelZh: "流程时间轴海报",
    blurbZh: "步骤节点 · 竖向时间轴",
    capabilityZh: "做流程时间轴海报：3–5 步节点说明方法/旅程",
    needsReference: false,
    aspectHint: "3:4",
    promptZh:
      "竖版流程时间轴海报，主题 [主题]。自上而下 3–5 个节点，每节点：短标题 + 一行说明 + 小图标或微缩插画。时间轴线清晰，配色统一，标题区写 [主标题]。比例 3:4。禁止密密麻麻段落、水印。",
  },

  // —— 摄影写实 ——
  {
    id: "pig_studio_run_portrait",
    group: "photo",
    labelZh: "棚拍奔跑肖像",
    blurbZh: "高调棚拍 · 动态抓拍",
    capabilityZh: "做高调棚拍动态肖像：奔跑瞬间、真笑、浅灰无缝背景",
    needsReference: true,
    aspectHint: "3:4",
    promptZh:
      "基于参考人像锁脸：高调棚拍肖像，浅灰无缝背景，人物开心奔跑跨步、真笑、休闲 oversize 穿搭；衣角与头发有自然动态。棚拍柔光，清晰锐利。比例 3:4。禁止字幕条、水印、改五官身份。",
  },
  {
    id: "pig_cinematic_summer_portrait",
    group: "photo",
    labelZh: "夏日电影肖像",
    blurbZh: "自然光 · 浅景深回眸",
    capabilityZh: "做竖幅电影感夏日肖像：自然光、浅景深、情绪回眸",
    needsReference: false,
    aspectHint: "9:16",
    promptZh:
      "电影感肖像摄影，超写实，竖幅 9:16。人物 [人物简述] 在夏日自然光下回眸或牵手瞬间，50/85mm 人像镜头浅景深，通透冷暖适中的夏季调色，皮肤质感真实。禁止字幕、水印、过度磨皮塑料脸。",
  },
  {
    id: "pig_editorial_fullbody",
    group: "photo",
    labelZh: "精品店全身时尚",
    blurbZh: "编辑部全身 · 店内环境",
    capabilityZh: "做编辑部时尚全身照：精品店环境、姿态自然、服装可读",
    needsReference: true,
    aspectHint: "3:4",
    promptZh:
      "基于参考锁脸：编辑部时尚全身照，人物站在高级精品店内，姿态自然松弛，服装面料纹理清晰，环境光柔和。竖幅 3:4，全身入画。禁止改脸、水印、夸张美颜。",
  },

  // —— 插画立体 ——
  {
    id: "pig_travel_doodle_journal",
    group: "illustration",
    labelZh: "旅行手账插画",
    blurbZh: "黑笔涂鸦 · 笔记本感",
    capabilityZh: "做旅行手账插画：黑笔涂鸦风画景点，适合笔记封面",
    needsReference: false,
    aspectHint: "3:4",
    promptZh:
      "迷人的编辑向旅行插画：主题 [目的地]。像用黑色毡头笔随手画在旅行笔记本上的涂鸦，线条轻松、留白多、个人感强。可点缀少量水彩色块。竖幅 3:4。禁止照片写实、水印、密密麻麻小字。",
  },
  {
    id: "pig_storybook_street",
    group: "illustration",
    labelZh: "故事书街头插画",
    blurbZh: "绘本风 · 笑颜街景",
    capabilityZh: "做故事书风人物街景插画：温暖绘本气质，适合封面/内页",
    needsReference: false,
    aspectHint: "3:4",
    promptZh:
      "故事书风格肖像插画：年轻人物在 [城市街道，如巴黎] 开心闭眼笑，手持咖啡，长发微风。温暖绘本笔触与柔和色彩，背景街景简化可读。竖幅 3:4。禁止照片写实、水印。",
  },
  {
    id: "pig_pencil_3d_double",
    group: "illustration",
    labelZh: "铅笔稿+3D 分身",
    blurbZh: "背景铅笔 · 前景立体角色",
    capabilityZh: "做铅笔大图作背景、前景站立体 3D 角色的创意合成",
    needsReference: true,
    aspectHint: "3:4",
    promptZh:
      "基于参考：背景是纸上大幅手绘铅笔素描（可带打哈欠等夸张姿势），前景站立一个皮克斯感 3D 立体角色分身，姿态随意。柔和电影光，层次分明。竖幅 3:4。锁脸身份一致。禁止水印、烧字字幕。",
  },

  // —— 角色人物 ——
  {
    id: "pig_character_sheet",
    group: "character",
    labelZh: "角色设定三视图",
    blurbZh: "锁脸设定表 · 服装结构",
    capabilityZh: "做角色设定表：正面/侧面/细节，锁脸保留服装结构",
    needsReference: true,
    aspectHint: "16:9",
    promptZh:
      "以上传参考为角色身份主参考，极高保真保留五官与体态。生成角色设定表：正面、侧面、关键服装/道具细节分格，干净白或浅灰背景，标注用极短中文可选。横幅 16:9。禁止改脸、水印、杂乱背景故事长文。",
  },
  {
    id: "pig_crochet_doll",
    group: "character",
    labelZh: "钩织角色玩偶",
    blurbZh: "毛线质感 · 手作温暖",
    capabilityZh: "做钩织玩偶角色图：毛线纹理、手作感，适合周边视觉",
    needsReference: false,
    aspectHint: "1:1",
    promptZh:
      "手工钩织玩偶：[角色简述]，柔软纱线纹理与针脚细节清晰；主色 [颜色1]、点缀 [颜色2]；手持小道具 [道具]；场景 [温馨场景]。温暖棚拍感，正方形 1:1。禁止真实人脸照片、水印。",
  },

  // —— 美食饮品 ——
  {
    id: "pig_food_ad_still",
    group: "food",
    labelZh: "美食广告静物",
    blurbZh: "蒸汽光泽 · 商业美食",
    capabilityZh: "做商业美食静物：光泽、蒸汽、食欲向打光",
    needsReference: false,
    aspectHint: "1:1",
    promptZh:
      "商业美食广告静物：[菜品/饮品]。新鲜质感、酱汁光泽、可选轻蒸汽；暖色主光 + 冷环境对比，台面干净。正方形 1:1。可底部一行 [品牌或菜名]。禁止脏乱背景、水印。",
  },
  {
    id: "pig_drink_splash_hero",
    group: "food",
    labelZh: "饮品飞溅英雄图",
    blurbZh: "液滴悬停 · 产品英雄",
    capabilityZh: "做饮品飞溅英雄图：瓶/杯居中，液滴与果肉悬停定格",
    needsReference: false,
    aspectHint: "3:4",
    promptZh:
      "饮品英雄广告图：[饮品名]。瓶或杯居中，果汁/咖啡液滴与果肉碎定格飞溅，高速度摄影感，背景纯净渐变。竖幅 3:4。禁止杂乱货架、水印。",
  },

  // —— 建筑空间 ——
  {
    id: "pig_interior_hero",
    group: "space",
    labelZh: "室内空间英雄镜头",
    blurbZh: "建筑摄影 · 空间纵深",
    capabilityZh: "做室内空间英雄镜头：纵深、材质、自然光可读",
    needsReference: false,
    aspectHint: "16:9",
    promptZh:
      "建筑室内摄影英雄镜头：[空间类型，如咖啡店/展厅/客厅]。透视纵深清楚，材质（木/石/布/金属）真实，自然光与人工光平衡，可有少量人物剪影增加尺度。横幅 16:9。禁止鱼眼扭曲、水印、过曝白墙空镜。",
  },
  {
    id: "pig_panorama_space",
    group: "space",
    labelZh: "空间氛围全景感",
    blurbZh: "宽画幅 · 可环顾层次",
    capabilityZh: "做宽画幅空间氛围图：前景中景远景层次，适合环境概念",
    needsReference: false,
    aspectHint: "2:1",
    promptZh:
      "宽画幅空间氛围图：[场景描述]。前景中景远景层次清晰，人眼高度视点，HDR 自然光影，适合环境概念板。画幅暗示 2:1 全景感（构图左右可延伸）。禁止普通海报中心构图、水印、可读乱字招牌。",
  },
];

export function listPlatformImageGenByGroup(): Array<{
  group: (typeof PLATFORM_IMAGE_GEN_GROUP_ORDER)[number];
  items: PlatformImageGenTemplate[];
}> {
  return PLATFORM_IMAGE_GEN_GROUP_ORDER.map((group) => ({
    group,
    items: PLATFORM_IMAGE_GEN_TEMPLATES.filter((t) => t.group === group.id),
  })).filter((g) => g.items.length > 0);
}

export function getPlatformImageGenTemplate(
  id: string,
): PlatformImageGenTemplate | null {
  return PLATFORM_IMAGE_GEN_TEMPLATES.find((t) => t.id === id) || null;
}

/** API 仅支持 9:16 / 16:9；竖向类映射 9:16，横向类映射 16:9 */
export function mapPlatformImageGenAspectForApi(
  hint: PlatformImageGenAspectHint,
): "9:16" | "16:9" {
  if (hint === "16:9" || hint === "2:1") return "16:9";
  return "9:16";
}

export function buildPlatformImageGenPrompt(
  id: string,
  opts?: { subjectHint?: string },
): string {
  const t = getPlatformImageGenTemplate(id);
  if (!t) return "";
  const hint = String(opts?.subjectHint || "").trim();
  const en = t.promptEn ? `\nEN: ${t.promptEn}` : "";
  const extra = hint ? `\n【用户补充】${hint.slice(0, 400)}` : "";
  return [
    `【文生图模板·${t.labelZh}】`,
    `能做什么：${t.capabilityZh}`,
    `画幅建议：${t.aspectHint}`,
    t.needsReference ? "须上传参考图。" : "可不传参考图。",
    t.promptZh,
    en.trim(),
    extra.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
