/**
 * Platform「文生图与海报」模板库。
 * 每个模板 = 用途说明 + 完整审美配套（色板/光影/字体/材质/构图/质控/负向），
 * 对齐自定义图文笔记「版式元结构」做法，禁止只塞一句干瘪提示词。
 * 前台零技术泄漏：不出现竞品站名 / 供应商名 / 模型名。
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

/** 单模板审美配套（对标图文笔记版式元结构） */
export type PlatformImageGenAestheticKit = {
  /** 主色/辅色/点缀 */
  paletteZh: string;
  /** 主光、辅光、环境光 */
  lightingZh: string;
  /** 标题/副文/角标层级；无字模板写「画面无字」 */
  typographyZh: string;
  /** 材质与纹理 */
  textureZh: string;
  /** 构图重心与留白 */
  compositionZh: string;
  /** 成稿质控 */
  qualityLockZh: string;
  /** 负向禁区 */
  negativeZh: string;
};

export type PlatformImageGenTemplate = {
  id: string;
  group: PlatformImageGenGroupId;
  labelZh: string;
  blurbZh: string;
  /** 能做什么：一句话用途，Picker 主展示 */
  capabilityZh: string;
  needsReference: boolean;
  aspectHint: PlatformImageGenAspectHint;
  /** 场面描述；可用 [[主体]] 占位，由用户补充词替换 */
  sceneZh: string;
  aesthetic: PlatformImageGenAestheticKit;
};

/** 全局审美底座：所有模板共用，再叠各模板配套 */
export const PLATFORM_IMAGE_GEN_AESTHETIC_META_ZH = `【商业成稿审美配套·强制】
1. 完整设计系统：色板、光影、字体层级、材质纹理、构图重心必须一次给齐；禁止灰蒙廉价棚拍空镜、禁止随机贴纸拼贴。
2. 印刷/广告级完成度：主体材质可读、边缘干净、层次分明；高细节但不脏乱。
3. 用户补充词是唯一题材锚点：替换模板占位，禁止跑题成无关品牌样例或模板示范物。
4. 屏内文字（若模板允许）一律简体中文、印刷清晰、不乱码；禁止水印、二维码、平台 UI 框、手机壳样机乱入（除非模板就是界面稿）。
5. 气质对标精品杂志广告页 / 博物馆海报 / 高端电商主图，而不是随手手机拍照。` as const;

const KIT = {
  luxuryDark: {
    paletteZh: "深墨底 + 旧金/琥珀点缀 + 冷高光；辅色克制不超过两种",
    lightingZh: "主光侧前方柔箱 + 边缘轮廓光 + 轻体积光；暗部保留层次勿死黑",
    typographyZh: "主标题厚重刊头级，副文细字一行；字距讲究，禁止手写乱涂",
    textureZh: "细微纸纹或金属拉丝、玻璃折射、织物织纹择一主导，忌塑料反光一片",
    compositionZh: "主体黄金分割或居中英雄位，四周呼吸留白，禁止元素墙",
    qualityLockZh: "商业广告印刷级、锐利对焦、无压缩糊边",
    negativeZh: "禁止水印、乱码字、塑料磨皮、过曝白墙、杂乱货架、廉价滤镜",
  } satisfies PlatformImageGenAestheticKit,
  cleanBright: {
    paletteZh: "高明度干净色场 + 1 个品牌主色点缀 + 低饱和中性灰",
    lightingZh: "均匀柔光为主，轻轮廓分离主体；阴影淡而干净",
    typographyZh: "顶部手写感或无衬线大标题 + 一行副文；文字不挡五官/产品关键面",
    textureZh: "平整色场或细微纸感，主体材质真实可读",
    compositionZh: "大色场托底 + 底部大胆裁切或中心静物；负空间充足",
    qualityLockZh: "清爽杂志封面级，边缘利落",
    negativeZh: "禁止脏底、贴纸堆叠、水印、过密小字墙、霓虹噪点",
  } satisfies PlatformImageGenAestheticKit,
  techEditorial: {
    paletteZh: "深炭灰/午夜蓝底 + 电青或品红点缀，对比克制",
    lightingZh: "体积光 + 边缘霓虹轮廓，主光仍要塑形，勿满屏闪瞎",
    typographyZh: "未来感无衬线大标题区；小字仅作日期/Slogan",
    textureZh: "玻璃、金属、半透明界面层与细网格，层次清楚",
    compositionZh: "中心人物或产品 + 透视纵深；背景元素服务主体",
    qualityLockZh: "高保真概念海报，透视干净",
    negativeZh: "禁止水印、UI 截图像素糊、杂乱贴纸、过曝霓虹糊成一团",
  } satisfies PlatformImageGenAestheticKit,
  warmFood: {
    paletteZh: "暖琥珀主光色 + 冷青绿环境补色；食欲向高饱和但不过火",
    lightingZh: "暖主光打酱汁光泽 + 冷环境反差；可选轻蒸汽背光",
    typographyZh: "底部一行菜名/品牌短句即可；可无字",
    textureZh: "酱汁高光、冷凝水珠、陶瓷/玻璃/金属真实物理",
    compositionZh: "产品英雄居中或略偏，台面干净，前景可有微距景深",
    qualityLockZh: "商业美食广告级，食欲感强",
    negativeZh: "禁止脏乱台面、水印、塑料假食物感、过曝死白",
  } satisfies PlatformImageGenAestheticKit,
  museumInfo: {
    paletteZh: "深炭或暖赭纸底 + 米白标注层 + 单色强调线",
    lightingZh: "博物馆展陈光：主光照亮主体，背景压暗有纹理",
    typographyZh: "短标签 + 细指引线；禁止长段落说明书墙",
    textureZh: "纹理画布 + 半透明示意图层 + 细网格",
    compositionZh: "中心主体 + 环形/分栏信息；留白与密度平衡",
    qualityLockZh: "百科信息设计级，印刷清晰",
    negativeZh: "禁止无关品牌 Logo、样例历史文物顶替用户主题、水印",
  } satisfies PlatformImageGenAestheticKit,
  photoSoft: {
    paletteZh: "自然肤色 + 环境互补色；夏季通透或棚拍中性灰",
    lightingZh: "自然窗光或棚拍柔箱；眼神光清楚，皮肤有微纹理",
    typographyZh: "画面无字（除非用户明确要求）",
    textureZh: "真实皮肤/织物/发丝；禁止塑料磨皮",
    compositionZh: "人像构图规范，头顶留白，景深服务主体",
    qualityLockZh: "编辑部摄影级，锁脸不失真",
    negativeZh: "禁止改五官身份、字幕条、水印、夸张美颜",
  } satisfies PlatformImageGenAestheticKit,
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
    sceneZh:
      "干净现代的排版旅行海报。城市名「[[主体]]」以粗黑体大写无衬线横贯画面宽度，字母内部或负空间无缝融入该城市地标剪影与天际线。底部一行小字国家/旅行短句。气质像精品旅行杂志跨页，而非旅游网站 banner。",
    aesthetic: {
      ...KIT.cleanBright,
      paletteZh: "从城市气质提取主色（如海岸青、古城赭、都会灰蓝）+ 大面积留白",
      typographyZh: "城市名即主视觉；底部一句细体副文；禁止贴纸式多行口号",
      compositionZh: "字形占满宽度，地标嵌字内；上下呼吸留白对称克制",
    },
  },
  {
    id: "pig_neon_designer_poster",
    group: "poster",
    labelZh: "霓虹创作者海报",
    blurbZh: "3D 角色居中 · 未来舞台",
    capabilityZh: "做霓虹蓝调创作者/活动海报：中心人物 + 舞台光效 + 大标题区",
    needsReference: false,
    aspectHint: "3:4",
    sceneZh:
      "超细节 3D 风格创作者活动海报，主题「[[主体]]」：年轻数字创作者自信站在画面中央，未来感蓝色霓虹舞台；oversized 街头穿搭，肩背轻轮廓光。顶部大标题区写活动名/主题，底部小字日期或 Slogan。商业级完成度，像一线厂牌主视觉。",
    aesthetic: KIT.techEditorial,
  },
  {
    id: "pig_soft_cutout_cover",
    group: "poster",
    labelZh: "清爽裁切图文封面",
    blurbZh: "色场 + 局部人像 + 手写标题",
    capabilityZh: "做明亮图文封面：大色场托底、底部大胆裁切主体、顶部手写感标题",
    needsReference: true,
    aspectHint: "3:4",
    sceneZh:
      "基于参考图锁脸生成明亮清爽图文封面，标题气质「[[主体]]」：大面积高明度纯净色场，主体自底部大胆裁切，只保留最有记忆点的局部。顶部大号手写感标题，中部一行副文。文字主动但不遮五官。像小红书/杂志封面成品，而非拼贴草稿。",
    aesthetic: KIT.cleanBright,
  },
  {
    id: "pig_mono_watercolor_travel",
    group: "poster",
    labelZh: "单色水彩旅行海报",
    blurbZh: "复古水彩 · 细线墨迹",
    capabilityZh: "做复古单色水彩旅行海报：城市剪影 + 细墨线 + 优雅留白",
    needsReference: false,
    aspectHint: "4:5",
    sceneZh:
      "极简复古水彩旅行海报，主题「[[主体]]」。整幅仅用优雅单色水彩与细墨线表现地标、街道与天空层次；标题区优雅书写城市名。气质像独立书店手绘海报，而非照片滤镜。",
    aesthetic: {
      paletteZh: "单一优雅主色（靛蓝/赭石/松绿择一）+ 纸白留白",
      lightingZh: "水彩晕染自然明暗，无需棚拍光感",
      typographyZh: "细墨线手写或铅字标题，忌粗黑网感大字",
      textureZh: "水彩纸纹、墨迹飞白、淡渍",
      compositionZh: "地标剪影 + 大留白；竖幅优雅",
      qualityLockZh: "印刷海报级水彩质感，边缘干净",
      negativeZh: "禁止照片写实、霓虹、贴纸拼贴、水印、多色花哨",
    },
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
    sceneZh:
      "高端电商主图静物，产品「[[主体]]」居中约占 60%。材质纹理清晰（金属/塑料/织物按真实物理），柔和棚拍主光 + 轻轮廓光，浅景深或纯净渐变背景。可底部一行小字卖点。对标旗舰店头图，而非白底杂物照。",
    aesthetic: {
      ...KIT.cleanBright,
      lightingZh: "柔箱主光 + 轮廓分离 + 台面轻反射；高光克制不爆",
      textureZh: "产品本体材质真实；台面哑光或微反射择一",
      compositionZh: "居中英雄静物，四周干净，禁止道具墙",
    },
  },
  {
    id: "pig_cutaway_miniature",
    group: "product",
    labelZh: "剖面微缩世界",
    blurbZh: "巨型容器切开 · 内部微缩场景",
    capabilityZh: "做剖面微缩广告图：巨型食物/产品切开，内部是完整微缩营业场景",
    needsReference: false,
    aspectHint: "16:9",
    sceneZh:
      "超写实 3D 微缩剖面广告：以巨型「[[主体]]」作为建筑外壳横切/半剖，内部是高度细节的微缩营业场景（工作人员与顾客活动）。宏观食物/产品纹理与微观室内材质并存；品牌感元素克制点缀。略侧英雄机位，干净虚化背景。像国际大奖广告片静帧。",
    aesthetic: {
      paletteZh: "暖内冷外：内部琥珀暖光，外部冷灰环境",
      lightingZh: "体积光与轻雾；内外光比戏剧但不脏",
      typographyZh: "画面可无字；若有仅角落极小品牌短句",
      textureZh: "剖面边缘可辨材质层次；微缩家具与人物比例严谨",
      compositionZh: "剖面占主视觉，背景干净虚化",
      qualityLockZh: "广告级 3D 完成度，细节丰富不糊",
      negativeZh: "禁止水印、比例崩坏、塑料假食物、杂乱文字墙",
    },
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
    sceneZh:
      "桌面应用图标：「[[主体]]」。单一圆角方（squircle）居中于纯白画布约占 80%，圆角连续平滑。主体轻拟物、现代、一眼可读。像正式上架图标提案，而非草稿贴图。",
    aesthetic: {
      paletteZh: "白底 + 品牌主色渐变或纯色块，高对比可读",
      lightingZh: "轻立体软阴影，高光一条即可",
      typographyZh: "图标内尽量无字；必要字母极简",
      textureZh: "玻璃/陶瓷/软塑轻拟物择一，忌脏噪",
      compositionZh: "绝对居中，四周等距白边",
      qualityLockZh: "矢量感清晰边缘，可缩放",
      negativeZh: "禁止复杂背景、说明书小字、多图标拼贴、水印",
    },
  },
  {
    id: "pig_material_logo_grid",
    group: "brand",
    labelZh: "材质 Logo 六宫格",
    blurbZh: "同一 Logo · 六种材质演绎",
    capabilityZh: "做品牌材质演绎宫格：同一标志用六种材质重塑，适合提案板",
    needsReference: false,
    aspectHint: "1:1",
    sceneZh:
      "高级 3×2 宫格提案板：品牌「[[主体]]」的同一标志分别用六种材质重塑（水、玻璃、金属拉丝、陶瓷、织物、霓虹）。每格标志悬浮于简洁统一场景。像品牌设计提案封面，而非素材堆砌。",
    aesthetic: {
      ...KIT.luxuryDark,
      compositionZh: "六宫格分割干净等分；每格标志居中；整体统一天空/背景",
      typographyZh: "格内无说明长文；角标可选材质名二字",
    },
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
    sceneZh:
      "高保真产品仪表盘 UI 概念，领域「[[主体]]」：左侧导航、顶部筛选、中央数据卡片与折线/柱状图、右侧明细。占位数字与中性标签，禁止真实隐私。圆角卡片、细分割线、克制阴影。像正式产品演示截图，而非线框潦草稿。",
    aesthetic: {
      paletteZh: "深色或浅色现代界面系统色 + 一条强调色",
      lightingZh: "平面 UI 光感，无写实棚拍阴影抢戏",
      typographyZh: "清晰字号层级；中文短标签；勿密密麻麻隐私数据",
      textureZh: "细分割线、轻磨砂卡片、图表矢量干净",
      compositionZh: "桌面 16:9 完整一屏信息架构",
      qualityLockZh: "高保真可演示级",
      negativeZh: "禁止照片拼贴、水印、贴纸、真实身份证号手机号",
    },
  },
  {
    id: "pig_mobile_app_screen",
    group: "ui",
    labelZh: "手机 App 界面",
    blurbZh: "竖屏界面 · 组件完整",
    capabilityZh: "做手机 App 单屏概念：状态栏到主按钮完整，适合功能示意",
    needsReference: false,
    aspectHint: "9:16",
    sceneZh:
      "精致手机 App 单屏，功能「[[主体]]」：含状态栏、导航标题、主内容区（列表或卡片）、底部主按钮。现代圆角组件、清晰间距、品牌主色统一。简短中文占位。像上架预览图，而非线框。",
    aesthetic: {
      paletteZh: "系统浅底或深底 + 品牌主色按钮",
      lightingZh: "扁平/轻拟物 UI，无摄影棚光",
      typographyZh: "导航标题 + 列表短句 + 主按钮文案，层级清楚",
      textureZh: "圆角、细分割、轻阴影",
      compositionZh: "竖屏完整一屏，安全区留白",
      qualityLockZh: "移动端高保真",
      negativeZh: "禁止真实隐私、水印、手机壳外框乱入（除非必要）",
    },
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
    sceneZh:
      "高级正方形工程/科普信息图：中心为「[[主体]]」清晰立体示意，周围环形标注 4–6 个关键模块（中文短标签 + 细指引线）。版式像精装手册单页。信息密度高但不拥挤，对标百科可视化成稿。",
    aesthetic: KIT.museumInfo,
  },
  {
    id: "pig_process_timeline_poster",
    group: "chart",
    labelZh: "流程时间轴海报",
    blurbZh: "步骤节点 · 竖向时间轴",
    capabilityZh: "做流程时间轴海报：3–5 步节点说明方法/旅程",
    needsReference: false,
    aspectHint: "3:4",
    sceneZh:
      "竖版流程时间轴海报，主题「[[主体]]」。自上而下 3–5 个节点，每节点：短标题 + 一行说明 + 小图标或微缩插画。时间轴线清晰，标题区写主标题。像培训手册封面级信息图。",
    aesthetic: {
      ...KIT.museumInfo,
      compositionZh: "竖向时间轴居中偏左或居中；节点间距均匀；顶部标题区",
      typographyZh: "节点短标题加粗 + 一行说明；禁止段落墙",
    },
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
    sceneZh:
      "基于参考人像锁脸：高调棚拍，「[[主体]]」气质的开心奔跑跨步、真笑、休闲 oversize 穿搭；衣角与头发自然动态。浅灰无缝背景。编辑部广告片感，而非证件照。",
    aesthetic: {
      ...KIT.photoSoft,
      paletteZh: "浅灰无缝 + 自然肤色 + 服装点缀色",
      lightingZh: "高调棚拍柔光，眼神光清楚，动态瞬间定格",
    },
  },
  {
    id: "pig_cinematic_summer_portrait",
    group: "photo",
    labelZh: "夏日电影肖像",
    blurbZh: "自然光 · 浅景深回眸",
    capabilityZh: "做竖幅电影感夏日肖像：自然光、浅景深、情绪回眸",
    needsReference: false,
    aspectHint: "9:16",
    sceneZh:
      "电影感肖像摄影，人物「[[主体]]」在夏日自然光下回眸或牵手瞬间，50/85mm 人像镜头浅景深，通透冷暖适中的夏季调色。竖幅情绪片感。",
    aesthetic: {
      ...KIT.photoSoft,
      paletteZh: "夏季通透：暖肤 + 青绿树影或天蓝",
      lightingZh: "自然窗光/黄金时段侧光，体积空气感",
      compositionZh: "竖幅 9:16，浅景深，眼神是重心",
    },
  },
  {
    id: "pig_editorial_fullbody",
    group: "photo",
    labelZh: "精品店全身时尚",
    blurbZh: "编辑部全身 · 店内环境",
    capabilityZh: "做编辑部时尚全身照：精品店环境、姿态自然、服装可读",
    needsReference: true,
    aspectHint: "3:4",
    sceneZh:
      "基于参考锁脸：编辑部时尚全身照，人物站在高级精品店内，气质「[[主体]]」，姿态自然松弛，服装面料纹理清晰。全身入画，像杂志内页而非自拍。",
    aesthetic: {
      ...KIT.photoSoft,
      lightingZh: "店内环境柔光 + 轻微轮廓，服装层次清楚",
      compositionZh: "全身竖幅，环境交代但不抢人",
      textureZh: "面料织纹、皮革/金属配饰微细节",
    },
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
    sceneZh:
      "编辑向旅行手账插画，目的地「[[主体]]」：像黑色毡头笔随手画在旅行笔记本上，线条轻松、留白多、个人感强；可点缀少量水彩色块。成品感像独立插画师封面。",
    aesthetic: {
      paletteZh: "墨黑线稿 + 少量水彩点缀色 + 米白纸底",
      lightingZh: "平面插画光感，靠线与留白塑形",
      typographyZh: "可有极小手写地名；禁止密密麻麻小字",
      textureZh: "纸纹、笔触飞白",
      compositionZh: "景点剪影居中偏上，四周手账留白",
      qualityLockZh: "印刷插画级，线条干净有个性",
      negativeZh: "禁止照片写实、水印、贴纸堆、网感粗黑体",
    },
  },
  {
    id: "pig_storybook_street",
    group: "illustration",
    labelZh: "故事书街头插画",
    blurbZh: "绘本风 · 笑颜街景",
    capabilityZh: "做故事书风人物街景插画：温暖绘本气质，适合封面/内页",
    needsReference: false,
    aspectHint: "3:4",
    sceneZh:
      "故事书风格肖像插画：人物在「[[主体]]」街景开心闭眼笑，可手持咖啡，长发微风。温暖绘本笔触，背景街景简化可读。像畅销绘本封面。",
    aesthetic: {
      paletteZh: "暖粉彩/奶油色 + 柔和街景色",
      lightingZh: "柔和绘本光，脸颊轻红晕",
      typographyZh: "画面可无字",
      textureZh: "水彩/水粉笔触，纸感",
      compositionZh: "人物半身或胸像，街景虚化简化",
      qualityLockZh: "商业绘本封面级",
      negativeZh: "禁止照片写实、水印、阴郁脏色",
    },
  },
  {
    id: "pig_pencil_3d_double",
    group: "illustration",
    labelZh: "铅笔稿+3D 分身",
    blurbZh: "背景铅笔 · 前景立体角色",
    capabilityZh: "做铅笔大图作背景、前景站立体 3D 角色的创意合成",
    needsReference: true,
    aspectHint: "3:4",
    sceneZh:
      "基于参考锁脸：背景是纸上大幅手绘铅笔素描（可夸张姿势），前景站立皮克斯感 3D 立体角色分身，气质「[[主体]]」。柔和电影光，层次分明。创意广告级合成。",
    aesthetic: {
      paletteZh: "铅笔灰阶背景 + 前景角色品牌色点缀",
      lightingZh: "前景立体角色电影柔光；背景素描平光",
      typographyZh: "画面无字",
      textureZh: "铅笔纸纹 vs 3D 次表面散射皮肤/布料",
      compositionZh: "背景大素描占满，前景角色站立可读",
      qualityLockZh: "双重媒介对比清晰，锁脸一致",
      negativeZh: "禁止水印、烧字字幕、换脸陌生人",
    },
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
    sceneZh:
      "以上传参考为角色身份主参考，极高保真保留五官与体态。生成角色设定表「[[主体]]」：正面、侧面、关键服装/道具细节分格，干净白或浅灰背景。像专业设定集单页。",
    aesthetic: {
      paletteZh: "白/浅灰底 + 服装本色",
      lightingZh: "均匀设定光，阴影轻，结构清楚",
      typographyZh: "可选极短中文标注；禁止长文故事",
      textureZh: "服装缝线/材质可读",
      compositionZh: "分格清晰，三视图对齐",
      qualityLockZh: "设定集印刷级，锁脸不失真",
      negativeZh: "禁止改脸、水印、杂乱背景故事长文",
    },
  },
  {
    id: "pig_crochet_doll",
    group: "character",
    labelZh: "钩织角色玩偶",
    blurbZh: "毛线质感 · 手作温暖",
    capabilityZh: "做钩织玩偶角色图：毛线纹理、手作感，适合周边视觉",
    needsReference: false,
    aspectHint: "1:1",
    sceneZh:
      "手工钩织玩偶「[[主体]]」：柔软纱线纹理与针脚细节清晰；温馨场景；可手持小道具。温暖棚拍感周边视觉，而非塑料公仔。",
    aesthetic: {
      paletteZh: "主色纱线 + 点缀对比色 + 暖米色场景",
      lightingZh: "温暖棚拍柔光，毛线高光柔和",
      typographyZh: "画面无字",
      textureZh: "针脚、绒毛、纱线股清晰可读",
      compositionZh: "玩偶居中，场景简单温馨",
      qualityLockZh: "手作周边广告级",
      negativeZh: "禁止真实人脸照片、水印、塑料光滑假毛线",
    },
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
    sceneZh:
      "商业美食广告静物「[[主体]]」：新鲜质感、酱汁光泽、可选轻蒸汽；暖色主光 + 冷环境对比，台面干净。可底部一行菜名/品牌。对标一线餐饮广告片静帧。",
    aesthetic: KIT.warmFood,
  },
  {
    id: "pig_drink_splash_hero",
    group: "food",
    labelZh: "饮品飞溅英雄图",
    blurbZh: "液滴悬停 · 产品英雄",
    capabilityZh: "做饮品飞溅英雄图：瓶/杯居中，液滴与果肉悬停定格",
    needsReference: false,
    aspectHint: "3:4",
    sceneZh:
      "饮品英雄广告图「[[主体]]」：瓶或杯居中，汁液/液滴与果肉碎高速摄影定格飞溅；背景纯净渐变或品牌色场。可顶部一句短标题（简体、印刷清晰）。气质像国际饮料品牌主视觉，而非货架抓拍。",
    aesthetic: {
      ...KIT.warmFood,
      paletteZh: "品牌主色场（用户未指定则从饮品本色提取）+ 金色高光点缀",
      lightingZh: "高速摄影硬朗高光 + 轮廓光勾产品；液滴晶莹",
      typographyZh: "可选顶部一句短标题；禁止大段广告文案墙",
      compositionZh: "竖幅英雄位，飞溅环绕但不挡标面",
      qualityLockZh: "商业饮料广告主视觉级，液滴物理真实",
      negativeZh: "禁止杂乱货架、水印、塑料假液体、乱码字",
    },
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
    sceneZh:
      "建筑室内摄影英雄镜头，空间「[[主体]]」：透视纵深清楚，木/石/布/金属材质真实，自然光与人工光平衡；可有少量人物剪影增加尺度。像建筑杂志跨页。",
    aesthetic: {
      paletteZh: "材质本色 + 环境冷暖平衡",
      lightingZh: "窗光主塑形 + 人工辅光；体积空气可轻有",
      typographyZh: "画面无字",
      textureZh: "建筑材质微细节清晰",
      compositionZh: "英雄透视，引导线进深",
      qualityLockZh: "建筑摄影印刷级",
      negativeZh: "禁止鱼眼扭曲、水印、过曝白墙空镜",
    },
  },
  {
    id: "pig_panorama_space",
    group: "space",
    labelZh: "空间氛围全景感",
    blurbZh: "宽画幅 · 可环顾层次",
    capabilityZh: "做宽画幅空间氛围图：前景中景远景层次，适合环境概念",
    needsReference: false,
    aspectHint: "2:1",
    sceneZh:
      "宽画幅空间氛围图「[[主体]]」：前景中景远景层次清晰，人眼高度视点，HDR 自然光影，适合环境概念板。构图左右可延伸，像电影建立镜头。",
    aesthetic: {
      paletteZh: "自然大气冷暖，忌荧光脏色",
      lightingZh: "HDR 自然光，层次保留高光暗部",
      typographyZh: "画面无字；禁止乱字招牌",
      textureZh: "大气透视与材质远近可读",
      compositionZh: "宽画幅层次，忌中心海报贴图感",
      qualityLockZh: "电影建立镜头级",
      negativeZh: "禁止普通中心海报构图、水印、可读乱字招牌",
    },
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

function fillSubjectPlaceholders(sceneZh: string, subjectHint: string): string {
  const hint = String(subjectHint || "").trim();
  const scene = String(sceneZh || "");
  if (!hint) {
    return scene.replace(/「?\[\[主体\]\]」?/g, "（请用户补充主体）");
  }
  return scene.replace(/\[\[主体\]\]/g, hint);
}

function formatAestheticKit(kit: PlatformImageGenAestheticKit): string {
  return [
    "【审美配套】",
    `色板：${kit.paletteZh}`,
    `光影：${kit.lightingZh}`,
    `字体：${kit.typographyZh}`,
    `材质：${kit.textureZh}`,
    `构图：${kit.compositionZh}`,
    `质控：${kit.qualityLockZh}`,
    `负向：${kit.negativeZh}`,
  ].join("\n");
}

export function buildPlatformImageGenPrompt(
  id: string,
  opts?: { subjectHint?: string },
): string {
  const t = getPlatformImageGenTemplate(id);
  if (!t) return "";
  const hint = String(opts?.subjectHint || "").trim();
  const scene = fillSubjectPlaceholders(t.sceneZh, hint);
  return [
    `【文生图模板·${t.labelZh}】`,
    `能做什么：${t.capabilityZh}`,
    `画幅建议：${t.aspectHint}`,
    t.needsReference ? "须上传参考图（锁身份/构图）。" : "可不传参考图。",
    PLATFORM_IMAGE_GEN_AESTHETIC_META_ZH,
    formatAestheticKit(t.aesthetic),
    "",
    "【场面】",
    scene,
    hint ? `\n【用户主体锚点】${hint.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
