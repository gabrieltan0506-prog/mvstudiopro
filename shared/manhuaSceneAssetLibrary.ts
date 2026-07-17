/**
 * AI 漫剧场景资产库：20 个爆款场景模板（场景解析 / 核心元素 / 生图提示词）。
 * 来源卡片：热门场景模板 01–20；目标是告别「拼素材廉价感」，落到电影分镜感。
 */

export type ManhuaSceneGenre =
  | "xianxia" // 仙侠
  | "ancient" // 古风
  | "urban" // 都市
  | "campus" // 校园
  | "apocalypse" // 末日
  | "scifi" // 科幻
  | "suspense"; // 悬疑

export const MANHUA_SCENE_GENRE_LABEL_ZH: Record<ManhuaSceneGenre, string> = {
  xianxia: "仙侠",
  ancient: "古风",
  urban: "都市",
  campus: "校园",
  apocalypse: "末日",
  scifi: "科幻",
  suspense: "悬疑",
};

export type ManhuaSceneTemplate = {
  /** scene_01 … scene_20 */
  id: string;
  no: number;
  nameZh: string;
  /** 主归属剧种（一张卡可属多剧种时取主） */
  genres: ManhuaSceneGenre[];
  /** 场景解析：定位 / 适用剧情 */
  analysis: string[];
  /** 核心视觉元素 */
  coreElements: string[];
  /** AI 生图提示词（中文） */
  promptZh: string;
};

export const MANHUA_SCENE_ASSET_LIBRARY: ManhuaSceneTemplate[] = [
  {
    id: "scene_01",
    no: 1,
    nameZh: "仙侠宗门场景",
    genres: ["xianxia"],
    analysis: ["宗门主场景", "适合开篇与拜师剧情", "画面要有云海与建筑层次"],
    coreElements: ["宗门大门", "群山云海", "仙门弟子", "灵气光效", "古建筑"],
    promptZh:
      "仙侠宗门，大型山门与层层宫殿，群山环绕，云海翻涌，仙门弟子身着长袍，御剑飞行，灵气光效缭绕，仙鹤飞舞，晨曦金光，史诗级构图，电影光影，超清细节。",
  },
  {
    id: "scene_02",
    no: 2,
    nameZh: "云海仙山",
    genres: ["xianxia"],
    analysis: ["强氛围空镜", "适合转场与修炼", "突出云海、飞瀑、浮空山"],
    coreElements: ["浮空山", "瀑布", "云海", "仙亭", "晨光薄雾"],
    promptZh:
      "云海仙山，浮空山峰拔地而起，飞瀑倾泻，仙亭建于悬崖之上，云海翻涌，薄雾缭绕，晨光洒落，仙鹤翱翔，空灵唯美，电影级光影，超清细节。",
  },
  {
    id: "scene_03",
    no: 3,
    nameZh: "练剑广场",
    genres: ["xianxia"],
    analysis: ["宗门练剑核心场", "适合修炼与弟子对决", "群像气势与层次"],
    coreElements: ["练剑台", "仙门弟子", "剑气光效", "山门广场", "石阶长廊"],
    promptZh:
      "宗门练剑广场，弟子列阵，御剑练习，晨光照耀，剑气纵横，山门广场，石阶长廊，旗幡飘扬，电影级光影，超清细节。",
  },
  {
    id: "scene_04",
    no: 4,
    nameZh: "秘境洞府",
    genres: ["xianxia"],
    analysis: ["神秘洞窟秘境", "适合奇遇、寻宝、闭关", "未知与神秘氛围"],
    coreElements: ["水晶洞窟", "上古石门", "灵泉", "法阵符文", "神秘雾气"],
    promptZh:
      "秘境洞府，发光晶石，古老石门，灵泉水面，符文法阵，宝物微光，神秘氛围，电影级光影，超清细节。",
  },
  {
    id: "scene_05",
    no: 5,
    nameZh: "魔族宫殿",
    genres: ["xianxia", "ancient"],
    analysis: ["反派主场", "大战前夕", "压迫感"],
    coreElements: ["黑曜宫殿", "猩红火焰", "魔族王座", "暗黑符文", "深渊气息"],
    promptZh:
      "魔族宫殿、黑曜石建筑、猩红能量、巨大王座、深渊火焰、暗黑史诗氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_06",
    no: 6,
    nameZh: "皇宫大殿",
    genres: ["ancient"],
    analysis: ["朝堂戏", "登基大典", "权谋对峙"],
    coreElements: ["龙椅", "金色宫灯", "朱红殿柱", "文武百官", "台阶仪仗"],
    promptZh:
      "皇宫大殿、金红色殿宇、龙椅、文武百官、宫灯高悬、权谋氛围、恢弘构图、电影级光影、超清细节。",
  },
  {
    id: "scene_07",
    no: 7,
    nameZh: "长安街市",
    genres: ["ancient"],
    analysis: ["市井生活", "出场转场", "烟火气"],
    coreElements: ["长安街巷", "商铺招牌", "灯笼", "人群摊位", "马车"],
    promptZh:
      "长安街市、盛唐商铺、来往人群、灯笼高挂、马车穿行、热闹烟火气、电影级光影、超清细节。",
  },
  {
    id: "scene_08",
    no: 8,
    nameZh: "古代府邸",
    genres: ["ancient"],
    analysis: ["宅斗日常", "家族剧情", "人物对话"],
    coreElements: ["庭院回廊", "月洞门", "池塘花木", "厅堂灯火", "世家府邸"],
    promptZh:
      "古代府邸、深宅庭院、回廊花园、月洞门、厅堂灯火、古典雅致、电影级光影、超清细节。",
  },
  {
    id: "scene_09",
    no: 9,
    nameZh: "战场废墟",
    genres: ["ancient", "apocalypse"],
    analysis: ["大战结局", "高燃冲突", "悲壮氛围"],
    coreElements: ["残垣断壁", "烟尘火光", "破碎战旗", "兵器残骸", "乌云天幕"],
    promptZh:
      "战场废墟、断墙残垣、火光烟尘、破碎战旗、冷色天空、史诗悲壮氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_10",
    no: 10,
    nameZh: "边塞城墙",
    genres: ["ancient"],
    analysis: ["边关守城", "出征送别", "家国氛围"],
    coreElements: ["边塞城墙", "烽火台", "黄沙风雪", "骑兵剪影", "火把城门"],
    promptZh:
      "边塞城墙、高耸关隘、烽火台、黄沙风雪、守军与骑兵、苍凉壮阔、电影级光影、超清细节。",
  },
  {
    id: "scene_11",
    no: 11,
    nameZh: "现代豪宅",
    genres: ["urban"],
    analysis: ["豪门剧情", "高端生活", "情感对峙"],
    coreElements: ["落地窗", "大理石", "泳池露台", "水晶吊灯", "城市夜景"],
    promptZh:
      "现代豪宅、落地玻璃、奢华客厅、泳池露台、城市夜景、豪门氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_12",
    no: 12,
    nameZh: "都市办公室",
    genres: ["urban"],
    analysis: ["职场剧情", "商务谈判", "霸总主线"],
    coreElements: ["会议室", "办公桌", "玻璃幕墙", "城市高楼", "商务灯光"],
    promptZh:
      "都市办公室、玻璃幕墙、会议室、城市高楼夜景、精英商务感、冷调高级、电影级光影、超清细节。",
  },
  {
    id: "scene_13",
    no: 13,
    nameZh: "酒吧夜店",
    genres: ["urban"],
    analysis: ["情感冲突场景", "邂逅与暧昧戏份", "都市夜生活氛围"],
    coreElements: ["霓虹灯牌", "调酒吧台", "舞池人群", "DJ舞台", "迷离灯光"],
    promptZh:
      "酒吧夜店、霓虹灯光、吧台酒柜、舞池人群、时尚都市氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_14",
    no: 14,
    nameZh: "校园教室",
    genres: ["campus"],
    analysis: ["青春校园场景", "日常对话互动", "成长与励志剧情"],
    coreElements: ["课桌椅", "黑板讲台", "窗边阳光", "校服学生", "青春氛围"],
    promptZh:
      "校园教室、整齐课桌、窗边阳光、学生身影、青春明亮、治愈氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_15",
    no: 15,
    nameZh: "未来城市",
    genres: ["scifi"],
    analysis: ["科幻主场", "建立世界观", "大场面空镜"],
    coreElements: ["摩天高楼", "全息广告", "飞行器", "霓虹天际线", "未来街区"],
    promptZh:
      "未来城市、超高摩天大楼、全息广告、飞行汽车、霓虹灯海、赛博科幻氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_16",
    no: 16,
    nameZh: "太空基地",
    genres: ["scifi"],
    analysis: ["星际剧情", "任务出发", "科技感场景"],
    coreElements: ["星舰停泊仓", "金属舱室", "巨型舷窗", "行星视野", "蓝白灯光"],
    promptZh:
      "太空基地、金属舱室、停泊飞船、巨型舷窗、宇宙行星、未来科技感、电影级光影、超清细节。",
  },
  {
    id: "scene_17",
    no: 17,
    nameZh: "废土避难所",
    genres: ["apocalypse"],
    analysis: ["末日生存", "团队据点", "资源争夺"],
    coreElements: ["金属围墙", "发电装置", "生存物资", "荒芜尘土", "幸存者营地"],
    promptZh:
      "废土避难所、拼接金属建筑、发电机、物资堆放、黄沙尘土、末日生存氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_18",
    no: 18,
    nameZh: "实验室",
    genres: ["scifi", "suspense"],
    analysis: ["科技实验", "阴谋揭露", "AI觉醒"],
    coreElements: ["玻璃舱体", "数据屏幕", "实验台", "冷白灯光", "科研设备"],
    promptZh:
      "实验室、玻璃实验舱、蓝白数据屏、未来科研设备、冷调科技氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_19",
    no: 19,
    nameZh: "密室探案现场",
    genres: ["suspense"],
    analysis: ["悬疑核心场", "线索搜集", "反转铺垫"],
    coreElements: ["封闭房间", "线索痕迹", "手电光束", "侦查道具", "紧张氛围"],
    promptZh:
      "密室探案现场、昏暗房间、凌乱线索、手电光束、侦查搜证、悬疑氛围、电影级光影、超清细节。",
  },
  {
    id: "scene_20",
    no: 20,
    nameZh: "黑客科技房间",
    genres: ["suspense", "scifi", "urban"],
    analysis: ["黑客入侵", "信息战", "科技角色主场"],
    coreElements: ["多屏电脑", "代码界面", "蓝绿霓虹", "服务器设备", "科技房间"],
    promptZh:
      "黑客科技房间、多屏显示器、代码流光、霓虹灯带、服务器设备、赛博科技感、电影级光影、超清细节。",
  },
];

export function listManhuaScenes(opts?: {
  genre?: ManhuaSceneGenre;
}): ManhuaSceneTemplate[] {
  const list = MANHUA_SCENE_ASSET_LIBRARY.slice();
  if (!opts?.genre) return list;
  return list.filter((s) => s.genres.includes(opts.genre!));
}

export function getManhuaSceneTemplate(id: string | undefined | null): ManhuaSceneTemplate | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_SCENE_ASSET_LIBRARY.find((s) => s.id === key || s.id === `scene_${key}`) || null;
}

/** 剧种默认场景池（可换）；自动推荐时只取第一条作「单一场景」 */
export const MANHUA_SCENE_GENRE_DEFAULTS: Record<ManhuaSceneGenre, string[]> = {
  xianxia: ["scene_01", "scene_02", "scene_03", "scene_04", "scene_05"],
  ancient: ["scene_06", "scene_07", "scene_08", "scene_09", "scene_10"],
  urban: ["scene_11", "scene_12", "scene_13"],
  campus: ["scene_14"],
  apocalypse: ["scene_17", "scene_09"],
  scifi: ["scene_15", "scene_16", "scene_18"],
  suspense: ["scene_19", "scene_20", "scene_18"],
};

/** 题材/剧种 → 推荐**一条**主场景（池内首条；用户可再换） */
export function recommendPrimaryManhuaSceneId(genre: ManhuaSceneGenre | undefined | null): string | null {
  if (!genre) return null;
  const id = MANHUA_SCENE_GENRE_DEFAULTS[genre]?.[0];
  return id && getManhuaSceneTemplate(id) ? id : null;
}

export function recommendPrimaryManhuaScene(
  genre: ManhuaSceneGenre | undefined | null,
): ManhuaSceneTemplate | null {
  return getManhuaSceneTemplate(recommendPrimaryManhuaSceneId(genre));
}

/**
 * 题材关键词 → 具体场景（⑤D）。
 * 比「剧种池首条」更细：如「秘境」→ scene_04，而非仙侠默认 scene_01。
 * 多命中时按匹配词数 + 最长词优先；可按剧种收窄候选。
 */
const SCENE_TOPIC_KEYWORDS: Array<{ sceneId: string; keys: string[] }> = [
  { sceneId: "scene_04", keys: ["秘境", "洞府", "寻宝", "闭关", "奇遇", "法阵", "灵泉", "水晶洞窟", "闯关", "试炼"] },
  { sceneId: "scene_03", keys: ["练剑", "对决", "剑气", "比武", "演武"] },
  { sceneId: "scene_02", keys: ["云海", "浮空山", "飞瀑", "仙山", "空镜"] },
  { sceneId: "scene_01", keys: ["宗门", "山门", "拜师", "仙门", "弟子入门"] },
  { sceneId: "scene_05", keys: ["魔族", "魔宫", "深渊", "反派宫殿", "黑曜"] },
  { sceneId: "scene_06", keys: ["皇宫", "大殿", "朝堂", "龙椅", "登基", "百官"] },
  { sceneId: "scene_07", keys: ["长安", "街市", "市井", "灯笼商铺", "烟火气"] },
  { sceneId: "scene_08", keys: ["府邸", "宅斗", "庭院", "世家", "回廊"] },
  { sceneId: "scene_09", keys: ["战场", "废墟", "残垣", "战旗", "大战"] },
  { sceneId: "scene_10", keys: ["边塞", "城墙", "烽火", "关隘", "黄沙"] },
  { sceneId: "scene_12", keys: ["办公室", "会议室", "职场", "霸总", "商务", "玻璃幕墙", "谈判桌", "年会"] },
  { sceneId: "scene_11", keys: ["豪宅", "豪门", "泳池", "落地窗", "别墅"] },
  { sceneId: "scene_13", keys: ["酒吧", "夜店", "霓虹", "舞池", "吧台"] },
  { sceneId: "scene_14", keys: ["校园", "教室", "校服", "课桌", "青春", "同学"] },
  { sceneId: "scene_16", keys: ["太空", "星舰", "飞船", "基地", "舷窗", "星际"] },
  { sceneId: "scene_15", keys: ["未来城市", "全息", "飞行器", "赛博", "天际线"] },
  { sceneId: "scene_17", keys: ["避难所", "废土", "末日", "幸存者", "营地"] },
  { sceneId: "scene_18", keys: ["实验室", "实验舱", "科研", "AI觉醒", "玻璃舱"] },
  { sceneId: "scene_19", keys: ["密室", "探案", "搜证", "线索", "推理现场"] },
  { sceneId: "scene_20", keys: ["黑客", "代码", "多屏", "信息战", "服务器"] },
];

export type ManhuaSceneTopicRecommend = {
  sceneId: string | null;
  entry: ManhuaSceneTemplate | null;
  reasonZh: string;
  matched: string[];
};

export function recommendManhuaSceneFromTopic(
  topic: string | undefined | null,
  opts?: { genre?: ManhuaSceneGenre | null },
): ManhuaSceneTopicRecommend {
  const text = String(topic || "").trim();
  if (!text) {
    const fallbackId = recommendPrimaryManhuaSceneId(opts?.genre);
    const entry = getManhuaSceneTemplate(fallbackId);
    return {
      sceneId: entry?.id || null,
      entry,
      reasonZh: entry ? `未填题材，按剧种默认「${entry.nameZh}」` : "未填题材且无剧种，暂无推荐",
      matched: [],
    };
  }

  const genreFilter = opts?.genre || null;
  let best: {
    sceneId: string;
    matched: string[];
    score: number;
    longest: number;
  } | null = null;

  for (const row of SCENE_TOPIC_KEYWORDS) {
    const entry = getManhuaSceneTemplate(row.sceneId);
    if (!entry) continue;
    if (genreFilter && !entry.genres.includes(genreFilter)) continue;
    const matched = row.keys.filter((k) => text.includes(k));
    if (!matched.length) continue;
    const longest = Math.max(...matched.map((m) => m.length));
    const score = matched.length * 10 + longest;
    if (
      !best ||
      score > best.score ||
      (score === best.score && matched.length > best.matched.length)
    ) {
      best = { sceneId: row.sceneId, matched, score, longest };
    }
  }

  // 弱匹配：场景名出现在题材里
  if (!best) {
    for (const entry of MANHUA_SCENE_ASSET_LIBRARY) {
      if (genreFilter && !entry.genres.includes(genreFilter)) continue;
      if (!text.includes(entry.nameZh)) continue;
      best = {
        sceneId: entry.id,
        matched: [entry.nameZh],
        score: entry.nameZh.length,
        longest: entry.nameZh.length,
      };
      break;
    }
  }

  if (best) {
    const entry = getManhuaSceneTemplate(best.sceneId);
    const hit = best.matched[0] || "";
    return {
      sceneId: entry?.id || null,
      entry,
      reasonZh: entry
        ? `题材命中「${hit}」→ 推荐「${entry.nameZh}」`
        : "命中关键词但场景缺失",
      matched: best.matched,
    };
  }

  const fallbackId = recommendPrimaryManhuaSceneId(genreFilter);
  const entry = getManhuaSceneTemplate(fallbackId);
  return {
    sceneId: entry?.id || null,
    entry,
    reasonZh: entry
      ? `题材未强命中具体场，按剧种默认「${entry.nameZh}」（可更换）`
      : "无可用场景推荐",
    matched: [],
  };
}

export function resolveManhuaScenes(opts?: {
  genre?: ManhuaSceneGenre;
  sceneId?: string;
  /** true：无 sceneId 时只回推荐的一条，不灌整包 */
  primaryOnly?: boolean;
}): ManhuaSceneTemplate[] {
  const one = getManhuaSceneTemplate(opts?.sceneId);
  if (one) return [one];
  if (opts?.genre) {
    if (opts.primaryOnly) {
      const primary = recommendPrimaryManhuaScene(opts.genre);
      return primary ? [primary] : [];
    }
    const ids = MANHUA_SCENE_GENRE_DEFAULTS[opts.genre] || [];
    return ids
      .map((id) => getManhuaSceneTemplate(id))
      .filter((s): s is ManhuaSceneTemplate => Boolean(s));
  }
  return [];
}

/** 注入故事/节拍/静帧：场景定位 + 核心元素 + 可直接套用的生图提示 */
export function composeManhuaScenePromptBlock(scenes: ManhuaSceneTemplate[]): string {
  if (!scenes.length) return "";
  const cards = scenes
    .map((s) => {
      const genreZh = s.genres.map((g) => MANHUA_SCENE_GENRE_LABEL_ZH[g]).join("/");
      return [
        `### 场景模板 ${String(s.no).padStart(2, "0")} · ${s.nameZh}（${genreZh}）`,
        `场景解析：${s.analysis.join("；")}`,
        `核心元素：${s.coreElements.join("、")}`,
        `生图提示词：${s.promptZh}`,
      ].join("\n");
    })
    .join("\n\n");
  return [
    "【漫剧场景资产库·强制套用】",
    "目标：告别「角色精美但场景廉价/拼贴感」。环境要有层次、纵深与可互动物件，角色必须「站进」场景，禁止纯白/空棚抠贴。",
    "节拍与静帧优先使用下列模板的场景定位与核心元素；可按题材微调专名，但不得抽空视觉元素。",
    "成稿去导演名/片名。",
    "",
    cards,
  ].join("\n");
}

export function composeManhuaSceneCatalogForGenre(genre: ManhuaSceneGenre): string {
  return composeManhuaScenePromptBlock(resolveManhuaScenes({ genre }));
}
