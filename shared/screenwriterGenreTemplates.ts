/**
 * 编剧剧种模板：选剧种 → 套场景资产库 → 题材一句微调。
 * 场景正文来自 shared/manhuaSceneAssetLibrary.ts（20 个爆款场景）。
 */

import {
  MANHUA_SCENE_GENRE_LABEL_ZH,
  composeManhuaSceneCatalogForGenre,
  composeManhuaScenePromptBlock,
  getManhuaSceneTemplate,
  resolveManhuaScenes,
  type ManhuaSceneGenre,
} from "./manhuaSceneAssetLibrary.js";
import {
  MANHUA_DRAMA_DEFAULT_PROMPTS,
  type ManhuaDramaStage,
} from "./videoReversePrompt.js";

export type ScreenwriterGenreTemplate = {
  id: ManhuaSceneGenre | string;
  labelZh: string;
  /** 一句话调性 / 卖点 */
  pitch: string;
  /** 开场钩子公式 */
  hookPattern: string;
  /** 角色槽位说明 */
  characterSlots: string;
  /** 6–8 镜节拍骨架（场景侧由资产库补） */
  beatSkeleton: string;
  /** 对白语气 */
  dialogueTone: string;
  /** 禁止崩坏 / 题材雷区 */
  avoid: string;
  /** 对应场景资产库剧种 */
  sceneGenre?: ManhuaSceneGenre;
  stageAddons?: Partial<Record<ManhuaDramaStage, string>>;
  ready: boolean;
};

export type ScreenwriterGenreId = ManhuaSceneGenre | (string & {});

export const SCREENWRITER_GENRE_TEMPLATES: ScreenwriterGenreTemplate[] = [
  {
    id: "xianxia",
    labelZh: "仙侠",
    pitch: "宗门云海 / 修炼对决 / 秘境奇遇，场景要有层次与灵气，告别空棚抠人",
    hookPattern: "开篇用宗门或云海空镜立世界观，3 秒内给出修行欲望或危机",
    characterSlots: "主角（外门/散修外形锚点）+ 对手或师父（服饰阶级一眼可辨）",
    beatSkeleton: "立场景→冲突触发→灵气/剑气反馈→转折→收镜（优先套场景资产库 01–05）",
    dialogueTone: "古白短句，忌现代网络梗",
    avoid: "场景空白、角色悬浮、重复同一山门连贴",
    sceneGenre: "xianxia",
    ready: true,
  },
  {
    id: "ancient",
    labelZh: "古风",
    pitch: "朝堂权谋 / 街市烟火 / 府邸宅斗 / 边塞家国",
    hookPattern: "用大殿、街市或府邸建立身份差，再丢冲突",
    characterSlots: "主位者（冠服仪仗）+ 对立者（官阶/门第可见）",
    beatSkeleton: "立场→对峙→人群/仪仗反馈→权力反转或离场（套 06–10）",
    dialogueTone: "文言白话混合，克制，不堆成语",
    avoid: "宫殿像摄影棚、街市无人气",
    sceneGenre: "ancient",
    ready: true,
  },
  {
    id: "urban",
    labelZh: "都市",
    pitch: "豪门对峙 / 职场谈判 / 夜店暧昧，冷调高级感",
    hookPattern: "夜景豪宅或办公室玻璃幕墙先立阶层，再进人物冲突",
    characterSlots: "精英外形锚点（西装/妆发）+ 对手或暧昧对象",
    beatSkeleton: "立场→谈判/对峙→霓虹或夜景反馈→情绪落点（套 11–13）",
    dialogueTone: "短促现实对白，可带职场信息差",
    avoid: "办公室像白墙会议室库存图",
    sceneGenre: "urban",
    ready: true,
  },
  {
    id: "campus",
    labelZh: "校园",
    pitch: "青春明亮 / 日常对话 / 成长励志，窗边阳光与校服锚点",
    hookPattern: "教室或窗边阳光开场，给出关系张力一句",
    characterSlots: "校服发型锚点 1–2 人，禁止崩成网红妆",
    beatSkeleton: "教室立场→互动→窗外/黑板反馈→收束（套 14）",
    dialogueTone: "口语青春，不油腻鸡汤",
    avoid: "教室空无一人或纯棚拍",
    sceneGenre: "campus",
    ready: true,
  },
  {
    id: "apocalypse",
    labelZh: "末日",
    pitch: "废土据点 / 资源争夺 / 悲壮生存",
    hookPattern: "尘土与金属围墙先立生存压力",
    characterSlots: "幸存者装备锚点（防尘巾/改装外套），脏污真实",
    beatSkeleton: "据点立场→物资/冲突→烟尘反馈→撤离或对峙（套 17，可借 09）",
    dialogueTone: "短、哑、喘气式对白",
    avoid: "末日却干净如广告片",
    sceneGenre: "apocalypse",
    ready: true,
  },
  {
    id: "scifi",
    labelZh: "科幻",
    pitch: "未来城市 / 太空基地 / 实验室，世界观空镜要有科技密度",
    hookPattern: "全息天际线或舷窗行星先立规则世界",
    characterSlots: "制服/面罩/接口锚点，去真人名",
    beatSkeleton: "世界观空镜→任务触发→舱室/数据反馈→离场（套 15–16、18）",
    dialogueTone: "冷静信息句 + 一句人性裂缝",
    avoid: "科幻空镜只有渐变背景",
    sceneGenre: "scifi",
    ready: true,
  },
  {
    id: "suspense",
    labelZh: "悬疑",
    pitch: "密室搜证 / 黑客主场 / 线索墙，光影压迫",
    hookPattern: "手电光束或多屏代码先给不安感",
    characterSlots: "探案者或黑客剪影锚点，道具先于脸",
    beatSkeleton: "封闭场→发现线索→反转铺垫→停在疑问（套 19–20，可借 18）",
    dialogueTone: "低声、半句、信息不全",
    avoid: "亮堂综艺探案感",
    sceneGenre: "suspense",
    ready: true,
  },
];

export function listScreenwriterGenres(opts?: { onlyReady?: boolean }): ScreenwriterGenreTemplate[] {
  const list = SCREENWRITER_GENRE_TEMPLATES.slice();
  if (opts?.onlyReady) return list.filter((g) => g.ready);
  return list;
}

export function getScreenwriterGenreTemplate(id: string | undefined | null): ScreenwriterGenreTemplate | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return SCREENWRITER_GENRE_TEMPLATES.find((g) => g.id === key) || null;
}

/** 题材关键词 → 剧种（未选手动剧种时自动套场景包） */
const GENRE_TOPIC_KEYWORDS: Record<string, string[]> = {
  xianxia: ["仙侠", "宗门", "修仙", "御剑", "灵气", "秘境", "仙门", "练剑", "魔族", "洞府", "云海"],
  ancient: ["古风", "皇宫", "朝堂", "长安", "府邸", "边塞", "龙椅", "宅斗", "权谋", "大殿", "烽火"],
  urban: ["都市", "豪门", "霸总", "办公室", "酒吧", "夜店", "豪宅", "职场", "总裁"],
  campus: ["校园", "教室", "校服", "青春", "高考", "同学", "课桌"],
  apocalypse: ["末日", "废土", "避难所", "幸存者", "荒原", "丧尸"],
  scifi: ["科幻", "星际", "太空", "飞船", "未来", "全息", "赛博", "星舰", "实验室", "AI觉醒"],
  suspense: ["悬疑", "密室", "探案", "黑客", "线索", "搜证", "推理", "信息战"],
};

export type InferManhuaGenreResult = {
  genreId: string;
  labelZh: string;
  score: number;
  matched: string[];
};

/**
 * 从题材一句推断剧种。无命中返回 null；平分时按登记顺序取先。
 */
export function inferManhuaGenreFromTopic(topic: string | undefined | null): InferManhuaGenreResult | null {
  const text = String(topic || "").trim();
  if (!text) return null;
  let best: InferManhuaGenreResult | null = null;
  for (const g of SCREENWRITER_GENRE_TEMPLATES) {
    if (!g.ready) continue;
    const kws = GENRE_TOPIC_KEYWORDS[g.id] || [];
    const matched = kws.filter((k) => text.includes(k));
    if (!matched.length) continue;
    const score = matched.length;
    if (!best || score > best.score) {
      best = { genreId: g.id, labelZh: g.labelZh, score, matched };
    }
  }
  return best;
}

/** 手动剧种优先；否则从题材推断 */
export function resolveManhuaGenreId(opts?: {
  genreId?: string;
  topic?: string;
}): { genreId?: string; inferred: boolean; infer?: InferManhuaGenreResult | null } {
  const explicit = getScreenwriterGenreTemplate(opts?.genreId);
  if (explicit?.ready) {
    return { genreId: explicit.id, inferred: false };
  }
  const infer = inferManhuaGenreFromTopic(opts?.topic);
  if (infer) return { genreId: infer.genreId, inferred: true, infer };
  return { genreId: undefined, inferred: false, infer: null };
}

export function composeGenreTemplatePromptBlock(genre: ScreenwriterGenreTemplate | null | undefined): string {
  if (!genre || !genre.ready) return "";
  const lines = [
    `【编剧剧种模板·${genre.labelZh}（id=${genre.id}）】`,
    genre.pitch ? `调性：${genre.pitch}` : "",
    genre.hookPattern ? `钩子公式：${genre.hookPattern}` : "",
    genre.characterSlots ? `角色槽位：${genre.characterSlots}` : "",
    genre.beatSkeleton ? `节拍骨架：${genre.beatSkeleton}` : "",
    genre.dialogueTone ? `对白语气：${genre.dialogueTone}` : "",
    genre.avoid ? `禁止崩坏：${genre.avoid}` : "",
    "硬规则：套模板后只允许按用户题材微调人设/场景名词，禁止打乱钩子与节拍因果；成稿去导演名/片名/真人名。",
  ].filter(Boolean);
  return lines.join("\n");
}

export type BuildManhuaStagePromptOpts = {
  genreId?: string;
  /** 单选场景模板 id（scene_01…）；优先于剧种默认场景包 */
  sceneId?: string;
  topic?: string;
  /** 编剧室已确认剧情包（注入故事/角色/节拍） */
  writerContext?: string;
  /** 编导阶段注入灯光运镜手法约束 */
  includeDirectorCraft?: boolean;
  directorCraftBlock?: string;
};

/**
 * 生成某阶段最终 prompt：默认句 + 剧种 + 场景资产库 + 题材。
 */
export function buildManhuaStagePromptWithGenre(
  stage: ManhuaDramaStage,
  opts?: BuildManhuaStagePromptOpts,
): string {
  const base = MANHUA_DRAMA_DEFAULT_PROMPTS[stage];
  const genre = getScreenwriterGenreTemplate(opts?.genreId);
  const genreBlock = composeGenreTemplatePromptBlock(genre);
  const addon = genre?.ready ? String(genre.stageAddons?.[stage] || "").trim() : "";
  const topic = String(opts?.topic || "").trim();
  const writerContext = String(opts?.writerContext || "").trim();

  const sceneGenre = genre?.sceneGenre;
  const scenes = resolveManhuaScenes({
    genre: sceneGenre,
    sceneId: opts?.sceneId,
  });
  const sceneBlock =
    stage === "story_brief" || stage === "episode_beats" || stage === "key_art" || stage === "video_reverse"
      ? opts?.sceneId
        ? composeManhuaScenePromptBlock(scenes)
        : sceneGenre
          ? composeManhuaSceneCatalogForGenre(sceneGenre)
          : ""
      : "";

  const parts = [base];
  if (writerContext && (stage === "story_brief" || stage === "character_bible" || stage === "episode_beats")) {
    parts.push(writerContext.slice(0, 6000));
  }
  if (genreBlock && (stage === "story_brief" || stage === "character_bible" || stage === "episode_beats")) {
    parts.push(genreBlock);
  }
  if (sceneBlock) parts.push(sceneBlock);
  if (
    opts?.includeDirectorCraft &&
    (stage === "episode_beats" || stage === "video_reverse" || stage === "key_art")
  ) {
    const craft = String(opts.directorCraftBlock || "").trim();
    if (craft) parts.push(craft);
  }
  if (addon) parts.push(`【剧种阶段附加·${stage}】\n${addon}`);
  if (topic) {
    parts.push(`【用户题材硬约束】${topic.slice(0, 800)}\n必须围绕该题材展开，禁止跑题。`);
  }
  if (stage === "key_art" && scenes[0]) {
    parts.push(
      `【本集主场景优先】${scenes[0].nameZh}\n直接吸收其生图提示词与核心元素，角色必须融入场景：\n${scenes[0].promptZh}`,
    );
  }
  return parts.join("\n\n");
}

export function summarizeGenreRegistry(): Array<{
  id: string;
  labelZh: string;
  ready: boolean;
  sceneCount: number;
}> {
  return SCREENWRITER_GENRE_TEMPLATES.map((g) => ({
    id: g.id,
    labelZh: g.labelZh,
    ready: g.ready,
    sceneCount: g.sceneGenre ? resolveManhuaScenes({ genre: g.sceneGenre }).length : 0,
  }));
}

export { MANHUA_SCENE_GENRE_LABEL_ZH, getManhuaSceneTemplate, resolveManhuaScenes };
