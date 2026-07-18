/**
 * 漫剧场景/道具「示范库」目录（按热度权重分批生成，非一次灌满）。
 *
 * 权重口径（产品侧，2026Jul18）：
 * - 多生：古风 · 仙侠 · 玄幻 · 逆袭爽感 · 情感甜宠 · 权谋 · 商战（权谋/商战可打海外）
 * - 适量：小说改编常见壳 · 悬疑 · 科幻
 * - 不生：沙雕搞笑（平台已下架）
 *
 * 不挂具体剧名、不抽帧；只借公开题材壳与视觉场。
 */

import type { ManhuaSceneGenre } from "./manhuaSceneAssetLibrary.js";

export type ManhuaDemoWeight = "high" | "medium" | "skip";

/** 内容赛道（比七剧种视觉场更贴市场） */
export type ManhuaContentLane =
  | "ancient" // 古风
  | "xianxia" // 仙侠
  | "xuanhuan" // 玄幻
  | "revenge" // 逆袭爽感
  | "romance" // 情感甜宠
  | "intrigue" // 权谋
  | "business" // 商战
  | "novel_shell" // 小说改编常见壳
  | "suspense" // 悬疑
  | "scifi" // 科幻
  | "comedy_skip"; // 沙雕搞笑 · 不下架队列

export const MANHUA_CONTENT_LANE_LABEL_ZH: Record<ManhuaContentLane, string> = {
  ancient: "古风",
  xianxia: "仙侠",
  xuanhuan: "玄幻",
  revenge: "逆袭爽感",
  romance: "情感甜宠",
  intrigue: "权谋",
  business: "商战",
  novel_shell: "小说改编壳",
  suspense: "悬疑",
  scifi: "科幻",
  comedy_skip: "沙雕搞笑（不下架队列）",
};

export const MANHUA_CONTENT_LANE_WEIGHT: Record<ManhuaContentLane, ManhuaDemoWeight> = {
  ancient: "high",
  xianxia: "high",
  xuanhuan: "high",
  revenge: "high",
  romance: "high",
  intrigue: "high",
  business: "high",
  novel_shell: "medium",
  suspense: "medium",
  scifi: "medium",
  comedy_skip: "skip",
};

/** 每日默认配额：high 优先，medium 少量 */
export const MANHUA_DAILY_DEMO_QUOTA = {
  highScenes: 3,
  highProps: 3,
  mediumScenes: 1,
  mediumProps: 1,
} as const;

export type ManhuaDemoAssetKind = "scene" | "prop";

export type ManhuaDemoAsset = {
  id: string;
  kind: ManhuaDemoAssetKind;
  lane: ManhuaContentLane;
  nameZh: string;
  /** 挂靠现有视觉剧种（注入/筛选用） */
  sceneGenre?: ManhuaSceneGenre;
  /** 可选挂 scene_01… 文案库 */
  sceneTemplateId?: string;
  /** 海外向备注（权谋/商战等） */
  overseasHintZh?: string;
  /** 纯文生示范图英文/中文提示（脚本会再包一层硬规则） */
  promptZh: string;
  weight: ManhuaDemoWeight;
};

/**
 * 示范槽：热门多、适量少；可继续往下追加，每日脚本按未生成缺口取。
 * 场景=空镜建立镜头；道具=白底/棚拍物特写。
 */
export const MANHUA_SCENE_PROP_DEMO_CATALOG: ManhuaDemoAsset[] = [
  // ── 古风 high ──
  {
    id: "demo_scene_ancient_palace",
    kind: "scene",
    lane: "ancient",
    nameZh: "皇宫大殿空镜",
    sceneGenre: "ancient",
    sceneTemplateId: "scene_06",
    promptZh:
      "中国古风皇宫金銮殿空镜，龙椅与朱红立柱，烛火与纱帘，无人或仅远处侍从剪影，电影级纵深光影，竖屏9:16，禁止现代物与文字水印。",
    weight: "high",
  },
  {
    id: "demo_scene_ancient_street",
    kind: "scene",
    lane: "ancient",
    nameZh: "长安街市夜市",
    sceneGenre: "ancient",
    sceneTemplateId: "scene_07",
    promptZh:
      "古风街市夜景空镜，灯笼商铺人潮烟火，青石板路与木楼，电影级氛围，竖屏9:16，禁止现代招牌与文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_ancient_jade",
    kind: "prop",
    lane: "ancient",
    nameZh: "传家玉佩",
    sceneGenre: "ancient",
    promptZh:
      "中国古风青白玉佩特写，绳结流苏，浅灰无缝背景棚拍，微距材质清晰，竖屏9:16，无文字无水印无手。",
    weight: "high",
  },
  {
    id: "demo_prop_ancient_hairpin",
    kind: "prop",
    lane: "ancient",
    nameZh: "金步摇发簪",
    sceneGenre: "ancient",
    promptZh:
      "古风金色步摇发簪道具特写，珠翠垂饰，白底棚拍，金属高光真实，竖屏9:16，无文字无水印。",
    weight: "high",
  },

  // ── 仙侠 high ──
  {
    id: "demo_scene_xianxia_sect",
    kind: "scene",
    lane: "xianxia",
    nameZh: "仙侠宗门山门",
    sceneGenre: "xianxia",
    sceneTemplateId: "scene_01",
    promptZh:
      "仙侠宗门山门与云海空镜，层层宫殿与飞鹤，晨曦灵气，史诗构图，竖屏9:16，角色极远或无脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_scene_xianxia_cave",
    kind: "scene",
    lane: "xianxia",
    nameZh: "秘境洞府",
    sceneGenre: "xianxia",
    sceneTemplateId: "scene_04",
    promptZh:
      "仙侠秘境水晶洞窟空镜，灵泉与符文法阵微光，神秘雾气，电影级光影，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_xianxia_sword",
    kind: "prop",
    lane: "xianxia",
    nameZh: "灵剑",
    sceneGenre: "xianxia",
    promptZh:
      "仙侠古剑道具特写，剑身淡蓝灵纹，浅灰背景棚拍，金属与符文质感，竖屏9:16，无文字无水印无手。",
    weight: "high",
  },
  {
    id: "demo_prop_xianxia_pill",
    kind: "prop",
    lane: "xianxia",
    nameZh: "丹药瓷瓶",
    sceneGenre: "xianxia",
    promptZh:
      "仙侠丹药小瓷瓶与两粒丹丸特写，白底棚拍，釉面与药香质感暗示，竖屏9:16，无文字无水印。",
    weight: "high",
  },

  // ── 玄幻 high ──
  {
    id: "demo_scene_xuanhuan_demon_palace",
    kind: "scene",
    lane: "xuanhuan",
    nameZh: "魔宫深渊",
    sceneGenre: "xianxia",
    sceneTemplateId: "scene_05",
    promptZh:
      "玄幻魔宫深渊空镜，黑曜石殿与猩红灵雾，压迫感构图，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_scene_xuanhuan_spirit_field",
    kind: "scene",
    lane: "xuanhuan",
    nameZh: "异界灵田",
    sceneGenre: "xianxia",
    promptZh:
      "玄幻异界灵田空镜，发光作物与浮空石，暮色天空，竖屏9:16，电影级细节，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_xuanhuan_token",
    kind: "prop",
    lane: "xuanhuan",
    nameZh: "妖族令牌",
    sceneGenre: "xianxia",
    promptZh:
      "玄幻兽纹令牌道具特写，暗红金属与兽瞳宝石，白底棚拍，竖屏9:16，无文字无水印。",
    weight: "high",
  },

  // ── 逆袭爽感 high ──
  {
    id: "demo_scene_revenge_rain_alley",
    kind: "scene",
    lane: "revenge",
    nameZh: "雨夜窄巷翻盘场",
    sceneGenre: "urban",
    promptZh:
      "都市雨夜窄巷空镜，霓虹倒影与积水，压迫后将爆发的气氛，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_scene_revenge_border_farm",
    kind: "scene",
    lane: "revenge",
    nameZh: "边关开荒田",
    sceneGenre: "ancient",
    promptZh:
      "古风边关开荒田野空镜，土墙茅屋与远处烽火台，粗粝生存感，竖屏9:16，电影级自然光，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_revenge_contract",
    kind: "prop",
    lane: "revenge",
    nameZh: "翻盘契约卷轴",
    sceneGenre: "ancient",
    promptZh:
      "古风空白契约卷轴与朱印盒特写（画面无可读文字），浅色背景棚拍，纸张纤维清晰，竖屏9:16，无水印。",
    weight: "high",
  },
  {
    id: "demo_prop_revenge_broken_token",
    kind: "prop",
    lane: "revenge",
    nameZh: "碎裂身份牌",
    sceneGenre: "urban",
    promptZh:
      "金属工牌或身份牌裂成两半特写，白底棚拍，划痕真实，竖屏9:16，牌面无清晰文字，无水印。",
    weight: "high",
  },

  // ── 情感甜宠 high ──
  {
    id: "demo_scene_romance_penthouse_night",
    kind: "scene",
    lane: "romance",
    nameZh: "夜景顶层落地窗",
    sceneGenre: "urban",
    sceneTemplateId: "scene_11",
    promptZh:
      "都市顶层豪宅夜景空镜，落地窗城市灯海，暖冷对比，浪漫高级感，竖屏9:16，无人脸，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_scene_romance_cafe_window",
    kind: "scene",
    lane: "romance",
    nameZh: "窗边咖啡厅",
    sceneGenre: "urban",
    promptZh:
      "都市日系咖啡厅窗边空镜，柔光与绿植，甜宠日常感，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_romance_ring_box",
    kind: "prop",
    lane: "romance",
    nameZh: "丝绒戒指盒",
    sceneGenre: "urban",
    promptZh:
      "深蓝丝绒戒指盒半开特写，细钻戒，白底棚拍，珠宝广告质感，竖屏9:16，无文字无水印。",
    weight: "high",
  },
  {
    id: "demo_prop_romance_lipstick",
    kind: "prop",
    lane: "romance",
    nameZh: "同款口红",
    sceneGenre: "urban",
    promptZh:
      "一支高级哑光口红与盖特写，浅灰背景棚拍，女性向甜宠道具感，竖屏9:16，瓶身无品牌字，无水印。",
    weight: "high",
  },

  // ── 权谋 high（海外向）──
  {
    id: "demo_scene_intrigue_court",
    kind: "scene",
    lane: "intrigue",
    nameZh: "朝堂对峙大殿",
    sceneGenre: "ancient",
    sceneTemplateId: "scene_06",
    overseasHintZh: "宫廷权谋视觉可出海，强调仪式感与压迫构图",
    promptZh:
      "东方宫廷朝堂大殿空镜，百官席位与高台王座，冷光侧逆，权谋压迫感，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_scene_intrigue_study",
    kind: "scene",
    lane: "intrigue",
    nameZh: "密谈书房夜",
    sceneGenre: "ancient",
    overseasHintZh: "密谋书房是海外权谋短剧高频场",
    promptZh:
      "古风深夜书房空镜，烛火、屏风与未展开的地图案台，阴谋密谈氛围，竖屏9:16，画面无可读文字，禁止水印。",
    weight: "high",
  },
  {
    id: "demo_prop_intrigue_seal",
    kind: "prop",
    lane: "intrigue",
    nameZh: "玉玺印泥盒",
    sceneGenre: "ancient",
    overseasHintZh: "权力信物特写，字幕市场友好",
    promptZh:
      "东方玉玺与印泥盒道具特写，朱红印泥质感，深色绒布背景，竖屏9:16，印面无清晰文字，无水印。",
    weight: "high",
  },
  {
    id: "demo_prop_intrigue_secret_letter",
    kind: "prop",
    lane: "intrigue",
    nameZh: "密信火漆",
    sceneGenre: "ancient",
    overseasHintZh: "密信是权谋叙事万能道具",
    promptZh:
      "古风密信封火漆印特写，羊皮纸纹理，浅色背景棚拍，竖屏9:16，纸面无可读文字，无水印。",
    weight: "high",
  },

  // ── 商战 high（海外向）──
  {
    id: "demo_scene_business_boardroom",
    kind: "scene",
    lane: "business",
    nameZh: "玻璃幕墙董事会",
    sceneGenre: "urban",
    sceneTemplateId: "scene_12",
    overseasHintZh: "商战董事会场全球通用",
    promptZh:
      "现代摩天楼董事会会议室空镜，长桌玻璃幕墙城市天际线，冷调高级感，竖屏9:16，无人脸，禁止文字水印与Logo。",
    weight: "high",
  },
  {
    id: "demo_scene_business_night_office",
    kind: "scene",
    lane: "business",
    nameZh: "深夜总裁办公室",
    sceneGenre: "urban",
    overseasHintZh: "海外霸总/商战共用视觉锚点",
    promptZh:
      "都市深夜总裁办公室空镜，落地窗灯海与威士忌杯剪影，权力感，竖屏9:16，无人脸，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_business_fountain_pen",
    kind: "prop",
    lane: "business",
    nameZh: "签约钢笔",
    sceneGenre: "urban",
    overseasHintZh: "签约特写跨文化可读",
    promptZh:
      "黑色金夹钢笔与空白合同角特写（无可读字），白底棚拍，商务质感，竖屏9:16，无品牌字无水印。",
    weight: "high",
  },
  {
    id: "demo_prop_business_black_umbrella",
    kind: "prop",
    lane: "business",
    nameZh: "黑色长柄伞",
    sceneGenre: "urban",
    overseasHintZh: "商战/霸总符号道具",
    promptZh:
      "黑色长柄雨伞收拢特写，浅灰背景棚拍，皮革手柄质感，竖屏9:16，无文字无水印。",
    weight: "high",
  },

  // ── 小说改编壳 medium ──
  {
    id: "demo_scene_novel_manor_yard",
    kind: "scene",
    lane: "novel_shell",
    nameZh: "宅斗府邸庭院",
    sceneGenre: "ancient",
    sceneTemplateId: "scene_08",
    promptZh:
      "古风世家府邸庭院空镜，回廊花窗与太湖石，宅斗氛围，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "medium",
  },
  {
    id: "demo_prop_novel_system_panel",
    kind: "prop",
    lane: "novel_shell",
    nameZh: "系统光幕（无字）",
    sceneGenre: "scifi",
    promptZh:
      "半透明蓝色全息系统面板道具感特写，悬浮光边，深色背景，面板内无任何可读文字仅几何光纹，竖屏9:16，无水印。",
    weight: "medium",
  },

  // ── 悬疑 medium ──
  {
    id: "demo_scene_suspense_room",
    kind: "scene",
    lane: "suspense",
    nameZh: "手电光束密室",
    sceneGenre: "suspense",
    sceneTemplateId: "scene_19",
    promptZh:
      "悬疑封闭房间空镜，手电光束切开灰尘，线索痕迹暗示，竖屏9:16，无人脸，禁止文字水印。",
    weight: "medium",
  },
  {
    id: "demo_prop_suspense_flashlight",
    kind: "prop",
    lane: "suspense",
    nameZh: "侦查手电",
    sceneGenre: "suspense",
    promptZh:
      "黑色战术手电道具特写，开一点点光斑，深灰背景棚拍，竖屏9:16，无文字无水印。",
    weight: "medium",
  },

  // ── 科幻 medium ──
  {
    id: "demo_scene_scifi_lab",
    kind: "scene",
    lane: "scifi",
    nameZh: "未来实验室",
    sceneGenre: "scifi",
    sceneTemplateId: "scene_16",
    promptZh:
      "科幻未来实验室空镜，全息台与冷白灯管，科技密度，竖屏9:16，无人脸，屏幕无可读文字，禁止水印。",
    weight: "medium",
  },
  {
    id: "demo_prop_scifi_chip",
    kind: "prop",
    lane: "scifi",
    nameZh: "神经芯片匣",
    sceneGenre: "scifi",
    promptZh:
      "科幻微型芯片匣道具特写，金属与蓝光指示，白底棚拍，竖屏9:16，无品牌字无水印。",
    weight: "medium",
  },

  // ── 多生补槽：逆袭 / 甜宠 / 权谋 / 商战（后续每日批次用）──
  {
    id: "demo_scene_revenge_rooftop",
    kind: "scene",
    lane: "revenge",
    nameZh: "天台对峙夜",
    sceneGenre: "urban",
    promptZh:
      "都市天台夜景空镜，铁丝网与城市灯海，逆袭对峙压迫感，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_revenge_usb",
    kind: "prop",
    lane: "revenge",
    nameZh: "关键证据U盘",
    sceneGenre: "urban",
    promptZh:
      "黑色金属U盘道具特写，白底棚拍，冷光高光，竖屏9:16，无品牌字无水印。",
    weight: "high",
  },
  {
    id: "demo_scene_romance_garden_bridge",
    kind: "scene",
    lane: "romance",
    nameZh: "夜色园林小桥",
    sceneGenre: "ancient",
    promptZh:
      "古风园林夜色小桥空镜，灯笼倒影与柳丝，甜宠氛围，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_romance_handkerchief",
    kind: "prop",
    lane: "romance",
    nameZh: "绣帕信物",
    sceneGenre: "ancient",
    promptZh:
      "古风绣帕道具特写，淡粉丝线暗纹（无可读文字），浅色背景棚拍，竖屏9:16，无水印。",
    weight: "high",
  },
  {
    id: "demo_scene_intrigue_prison",
    kind: "scene",
    lane: "intrigue",
    nameZh: "天牢审讯廊",
    sceneGenre: "ancient",
    overseasHintZh: "权谋压迫场，海外字幕剧友好",
    promptZh:
      "古风天牢石廊空镜，铁栅与唯一束顶光，权谋审讯压迫感，竖屏9:16，无人脸特写，禁止文字水印。",
    weight: "high",
  },
  {
    id: "demo_prop_intrigue_chess",
    kind: "prop",
    lane: "intrigue",
    nameZh: "残局棋盘",
    sceneGenre: "ancient",
    overseasHintZh: "权谋隐喻道具，跨文化可读",
    promptZh:
      "古风木质围棋残局特写，深色绒布背景，棋子材质清晰，竖屏9:16，无文字无水印。",
    weight: "high",
  },
  {
    id: "demo_scene_business_trading_floor",
    kind: "scene",
    lane: "business",
    nameZh: "夜盘交易大屏",
    sceneGenre: "urban",
    overseasHintZh: "商战视觉全球通用",
    promptZh:
      "现代金融交易大厅空镜，多块行情大屏蓝绿冷光（屏幕无清晰数字文字），竖屏9:16，无人脸，禁止Logo水印。",
    weight: "high",
  },
  {
    id: "demo_prop_business_watch",
    kind: "prop",
    lane: "business",
    nameZh: "商务腕表",
    sceneGenre: "urban",
    overseasHintZh: "阶层符号道具",
    promptZh:
      "黑色表盘商务机械腕表特写，白底棚拍，金属表带质感，竖屏9:16，表盘无品牌字无水印。",
    weight: "high",
  },
];

export function getManhuaDemoAsset(id: string | undefined | null): ManhuaDemoAsset | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_SCENE_PROP_DEMO_CATALOG.find((a) => a.id === key) || null;
}

/** 浏览器可访问路径（需先跑 manhua:scene-prop-daily 落盘） */
export function getManhuaDemoAssetPublicUrl(id: string | undefined | null): string {
  const a = getManhuaDemoAsset(id);
  if (!a) return "";
  return a.kind === "scene" ? `/manhua-scenes/${a.id}.jpg` : `/manhua-props/${a.id}.jpg`;
}

export function listManhuaDemoAssetsForSceneTemplate(sceneTemplateId: string | undefined | null): ManhuaDemoAsset[] {
  const key = String(sceneTemplateId || "").trim();
  if (!key) return [];
  return listManhuaDemoAssets({ kind: "scene" }).filter(
    (a) => a.sceneTemplateId === key || a.sceneTemplateId === `scene_${key}`,
  );
}

export function listManhuaDemoPropsForLane(lane: ManhuaContentLane | undefined | null): ManhuaDemoAsset[] {
  if (!lane || lane === "comedy_skip") return [];
  return listManhuaDemoAssets({ kind: "prop", lane });
}

/** 静帧/节拍：挂示范空镜的视觉锚点（文案级；图在 public 时路径可给本地预览） */
export function composeManhuaSceneDemoAnchorBlock(sceneTemplateId: string | undefined | null): string {
  const demos = listManhuaDemoAssetsForSceneTemplate(sceneTemplateId).slice(0, 2);
  if (!demos.length) return "";
  const lines = demos.map((a) => {
    const url = getManhuaDemoAssetPublicUrl(a.id);
    return `- ${a.nameZh}（${MANHUA_CONTENT_LANE_LABEL_ZH[a.lane]}）${url ? ` · ${url}` : ""}\n  锚点：${a.promptZh}`;
  });
  return [
    "【场景示范图锚点】",
    "下列为空镜示范资产（原创、无剧名）。静帧环境层次优先对齐；角色必须站进场景，禁止空棚抠贴。",
    ...lines,
  ].join("\n");
}

/** 编剧室/角色圣经：道具示范外观锚点 */
export function composeManhuaPropDemoPromptBlock(opts?: {
  lanes?: ManhuaContentLane[];
  limit?: number;
}): string {
  const limit = Math.max(1, Math.min(8, opts?.limit ?? 4));
  const prefer =
    opts?.lanes?.length
      ? opts.lanes
      : (["intrigue", "business", "revenge", "romance", "ancient", "xianxia"] as ManhuaContentLane[]);
  const picked: ManhuaDemoAsset[] = [];
  for (const lane of prefer) {
    for (const p of listManhuaDemoPropsForLane(lane)) {
      if (picked.length >= limit) break;
      if (!picked.some((x) => x.id === p.id)) picked.push(p);
    }
    if (picked.length >= limit) break;
  }
  if (!picked.length) return "";
  const lines = picked.map((a) => {
    const overseas = a.overseasHintZh ? `｜海外：${a.overseasHintZh}` : "";
    return `- ${a.nameZh}｜${MANHUA_CONTENT_LANE_LABEL_ZH[a.lane]}${overseas}\n  外观：${a.promptZh}`;
  });
  return [
    "【道具示范库】",
    "外观锚点可锁定连载外形；禁止抄具体剧名道具造型。权谋/商战道具优先考虑海外可读符号。",
    ...lines,
  ].join("\n");
}

/** 题材关键词 → 内容赛道（用于道具示范挑选） */
const LANE_TOPIC_KEYS: Array<{ lane: ManhuaContentLane; keys: string[] }> = [
  { lane: "intrigue", keys: ["权谋", "朝堂", "密谋", "宫廷", "皇权", "宦官", "廷议"] },
  { lane: "business", keys: ["商战", "并购", "董事会", "总裁", "上市", "股权", "合同"] },
  { lane: "revenge", keys: ["逆袭", "翻盘", "打脸", "开荒", "战神", "重生复仇"] },
  { lane: "romance", keys: ["甜宠", "恋爱", "先婚", "追妻", "情侣", "告白"] },
  { lane: "xuanhuan", keys: ["玄幻", "妖族", "魔宫", "灵田", "异界"] },
  { lane: "xianxia", keys: ["仙侠", "宗门", "修仙", "御剑", "秘境", "灵剑"] },
  { lane: "ancient", keys: ["古风", "皇宫", "街市", "府邸", "边塞", "宅斗"] },
  { lane: "suspense", keys: ["悬疑", "密室", "搜证", "杀手", "线索"] },
  { lane: "scifi", keys: ["科幻", "机甲", "太空", "实验室", "全息"] },
  { lane: "novel_shell", keys: ["系统", "穿越", "小说改编", "金手指"] },
];

export function recommendManhuaContentLanesFromTopic(topic: string | undefined | null): ManhuaContentLane[] {
  const t = String(topic || "");
  if (!t.trim()) return ["romance", "intrigue", "business"];
  const hits: ManhuaContentLane[] = [];
  for (const row of LANE_TOPIC_KEYS) {
    if (row.keys.some((k) => t.includes(k))) hits.push(row.lane);
  }
  return hits.length ? hits : ["romance", "intrigue", "business"];
}

/** 视觉剧种 → 优先内容赛道（下拉剧种时的示范库默认） */
export function contentLanesForSceneGenre(genre: ManhuaSceneGenre | undefined | null): ManhuaContentLane[] {
  switch (genre) {
    case "xianxia":
      return ["xianxia", "xuanhuan", "revenge"];
    case "ancient":
      return ["ancient", "intrigue", "romance"];
    case "urban":
      return ["business", "romance", "revenge"];
    case "campus":
      return ["romance", "revenge"];
    case "apocalypse":
      return ["revenge", "suspense"];
    case "scifi":
      return ["scifi", "novel_shell"];
    case "suspense":
      return ["suspense", "intrigue"];
    default:
      return ["romance", "intrigue", "business"];
  }
}

export function listManhuaDemoAssets(opts?: {
  kind?: ManhuaDemoAssetKind;
  weight?: ManhuaDemoWeight | ManhuaDemoWeight[];
  lane?: ManhuaContentLane | ManhuaContentLane[];
}): ManhuaDemoAsset[] {
  let list = MANHUA_SCENE_PROP_DEMO_CATALOG.slice();
  if (opts?.kind) list = list.filter((a) => a.kind === opts.kind);
  if (opts?.weight) {
    const ws = Array.isArray(opts.weight) ? opts.weight : [opts.weight];
    list = list.filter((a) => ws.includes(a.weight));
  }
  if (opts?.lane) {
    const ls = Array.isArray(opts.lane) ? opts.lane : [opts.lane];
    list = list.filter((a) => ls.includes(a.lane));
  }
  return list.filter((a) => a.weight !== "skip");
}

/**
 * 按每日配额挑选未完成槽。
 * high 档在多生赛道间轮转（古风/仙侠/玄幻/逆袭/甜宠/权谋/商战），避免前几日只灌古风。
 */
export function pickDailyManhuaDemoBatch(
  alreadyDoneIds: Set<string>,
  quota: Partial<typeof MANHUA_DAILY_DEMO_QUOTA> = {},
): ManhuaDemoAsset[] {
  const q = { ...MANHUA_DAILY_DEMO_QUOTA, ...quota };
  const pending = listManhuaDemoAssets().filter((a) => !alreadyDoneIds.has(a.id));
  const highLaneOrder: ManhuaContentLane[] = [
    "ancient",
    "xianxia",
    "xuanhuan",
    "revenge",
    "romance",
    "intrigue",
    "business",
  ];

  const takeRoundRobin = (weight: ManhuaDemoWeight, kind: ManhuaDemoAssetKind, n: number) => {
    const out: ManhuaDemoAsset[] = [];
    if (n <= 0) return out;
    const pool = pending.filter((a) => a.weight === weight && a.kind === kind);
    if (weight !== "high") return pool.slice(0, n);

    const byLane = new Map<ManhuaContentLane, ManhuaDemoAsset[]>();
    for (const a of pool) {
      const arr = byLane.get(a.lane) || [];
      arr.push(a);
      byLane.set(a.lane, arr);
    }
    let guard = 0;
    while (out.length < n && guard < n * highLaneOrder.length + 8) {
      const lane = highLaneOrder[guard % highLaneOrder.length]!;
      guard += 1;
      const arr = byLane.get(lane);
      if (!arr?.length) continue;
      const next = arr.shift()!;
      if (!out.some((x) => x.id === next.id)) out.push(next);
    }
    // 赛道耗尽时用剩余 high 补齐
    for (const a of pool) {
      if (out.length >= n) break;
      if (!out.some((x) => x.id === a.id)) out.push(a);
    }
    return out;
  };

  const picked = [
    ...takeRoundRobin("high", "scene", q.highScenes),
    ...takeRoundRobin("high", "prop", q.highProps),
    ...takeRoundRobin("medium", "scene", q.mediumScenes),
    ...takeRoundRobin("medium", "prop", q.mediumProps),
  ];
  const seen = new Set<string>();
  return picked.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}
