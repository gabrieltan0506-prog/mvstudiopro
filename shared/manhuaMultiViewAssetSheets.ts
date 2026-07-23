/**
 * 漫剧资产多视角设定板：
 * - 跨集（≥2 集出现）场景 → 单张 2×2 四视角空镜拼板
 * - 具名主角（外形+动机齐全）→ 主图 + 正侧背三视图 + 配色/道具设定板
 * - 配角/群众 → 仍用原半身定妆
 *
 * 版式参考公开「四视角场景卡 / 服饰图鉴设定板」，产品侧禁字硬锁，画面不烧标签。
 */

import {
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
} from "./manhuaScriptWorkbench.js";
import type { ManhuaWriterAssetAnchor } from "./manhuaWriterAssetCanon.js";

export type ManhuaEpisodeBodyRef = {
  index: number;
  body?: string;
  title?: string;
};

/** 群众/无名群体：不走主角设定板 */
const EXTRA_OR_CROWD_NAME_RE =
  /^(众|众人|群众|群演|路人|百姓|流民|军士|士兵|卫兵|侍卫|甲士|太监|宫女|宫人|宾客|围观|仆从|随从|丫鬟|小厮|衙役|捕快|匪众|贼众|敌军|我军|边军众|众人甲|众人乙)/;

const COLOR_TOKEN_RE =
  /(?:玄|墨|青|白|红|朱|绛|紫|金|银|灰|褐|蓝|绿|翠|黄|橙|粉|米|杏|玉|铁|铜|乌|深|浅|暗|亮)?(?:黑|白|灰|红|朱|绛|紫|金|银|青|蓝|绿|翠|黄|褐|杏|米|玉色|玄色|墨色|铁色|铜色)[色彩]?/g;

export function countEpisodesMentioningLocation(
  location: Pick<ManhuaWriterAssetAnchor, "nameZh" | "aliasZh">,
  episodes: ManhuaEpisodeBodyRef[] | null | undefined,
): number {
  const names = [location.nameZh, location.aliasZh]
    .map((s) => String(s || "").trim())
    .filter((s) => s.length >= 2);
  if (!names.length || !episodes?.length) return 0;
  let hit = 0;
  for (const ep of episodes) {
    const body = `${ep.title || ""}\n${ep.body || ""}`;
    if (!body.trim()) continue;
    if (names.some((n) => body.includes(n))) hit += 1;
  }
  return hit;
}

/** B1：名称在 ≥2 集正文/标题出现 → 四视角拼板 */
export function locationNeedsFourViewGrid(
  location: Pick<ManhuaWriterAssetAnchor, "nameZh" | "aliasZh">,
  episodes: ManhuaEpisodeBodyRef[] | null | undefined,
): boolean {
  return countEpisodesMentioningLocation(location, episodes) >= 2;
}

/**
 * C2：具名 + 外形/动机字段较完整 → 主角设定板；
 * 群众称呼或字段过薄 → 旧半身定妆。
 */
export function isManhuaHeroCharacterAnchor(
  character: Pick<ManhuaWriterAssetAnchor, "nameZh" | "lookZh" | "motiveZh" | "noteZh">,
): boolean {
  const name = String(character.nameZh || "").trim();
  if (!name || name.length < 2) return false;
  if (EXTRA_OR_CROWD_NAME_RE.test(name)) return false;
  if (/甲$|乙$|丙$|丁$|A$|B$/.test(name) && name.length <= 3) return false;
  const look = String(character.lookZh || "").trim();
  const motive = String(character.motiveZh || "").trim();
  if (look.length < 10) return false;
  if (motive.length < 4) return false;
  // 外形里至少有服化/年龄/面部一类可读锚
  if (!/(岁|脸|眉|眼|发|袍|甲|衣|裙|衫|裳|簪|佩|疤|肤|身)/.test(look)) return false;
  return true;
}

/** 从外形句抽 3–5 个配色词，供设定板色条描述（不要求画面烧字） */
export function extractWardrobePaletteTokensZh(lookZh: string, limit = 5): string[] {
  const raw = String(lookZh || "");
  const found = raw.match(COLOR_TOKEN_RE) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of found) {
    const k = t.replace(/色$/, "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.length <= 4 ? t : k);
    if (out.length >= limit) break;
  }
  return out;
}

/** 与角色相关的道具：名称/备注/功能命中角色名，否则取系列前若干件 */
export function pickPropsForCharacterSheet(
  character: Pick<ManhuaWriterAssetAnchor, "nameZh" | "aliasZh" | "lookZh" | "noteZh">,
  props: ManhuaWriterAssetAnchor[] | null | undefined,
  limit = 3,
): ManhuaWriterAssetAnchor[] {
  const list = props || [];
  if (!list.length) return [];
  const needles = [character.nameZh, character.aliasZh]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const look = String(character.lookZh || "");
  const related = list.filter((p) => {
    const blob = `${p.nameZh} ${p.motiveZh || ""} ${p.noteZh || ""} ${p.lookZh || ""}`;
    if (needles.some((n) => blob.includes(n))) return true;
    // 外形句里已写到的物件名
    return Boolean(p.nameZh && look.includes(p.nameZh));
  });
  const picked = (related.length ? related : list).slice(0, limit);
  return picked;
}

/** A1：同一场景四视角，单张 2×2（整图 9:16） */
export function buildManhuaSceneFourViewGridPrompt(opts: {
  sceneNameZh: string;
  scenePromptZh: string;
  topic?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
  episodeHitCount?: number;
}): string {
  const name = String(opts.sceneNameZh || "").trim() || "主场景";
  const scenePrompt = String(opts.scenePromptZh || "").trim();
  const topic = String(opts.topic || "").trim();
  const styleLabel = String(opts.artStyleLabelZh || "").trim();
  const stylePrompt = String(opts.artStylePromptZh || "").trim();
  const hits = Math.max(0, Math.floor(opts.episodeHitCount || 0));
  return [
    "生成一张竖版漫剧场景「空间参考卡」（整图 9:16）：严格均分为 2×2 四格，格子等大、细暗线分隔，禁止跨格融合。",
    "四格是同一地点的四种机位，供后续视频换角度时锁空间；不是四张无关景。",
    "内部先抽取（勿写出分析过程）：艺术风格、核心主体物、环境背景、光影类型；四格必须共享同一风格、同一光影逻辑、同一材质与陈设布局。",
    "四格布局（画面内禁止格号、字母、数字、箭头、UI）：",
    "左上·主视角：完整环境 + 核心主体，尽量贴近本集建立镜头的纵深。",
    "右上·正面聚焦：更正面、略推近核心主体，空间层次仍可读。",
    "左下·高俯斜角：自屋顶/崖岸斜俯，看清主体与地面动线。",
    "右下·正俯：近似垂直俯视，看清主体平面轮廓与地面相对位置，透视压平。",
    "每格保持同一竖构图内容比例；空镜为主，人物最多极远剪影。",
    `（隐藏场景名·不必画出：${name}${hits >= 2 ? `·跨${hits}集空间锁` : ""}）`,
    scenePrompt ? `请画出的场景视觉：${scenePrompt}` : "",
    topic ? `（隐藏题材氛围·绝不能写成标题：${topic.slice(0, 120)}）` : "",
    styleLabel ? `【画风】${styleLabel}` : "",
    stylePrompt || "",
    "一致性硬锁：四格建筑相对位置、道路/水面走向、关键道具落点不得漂移；禁止把四格画成四个不同地点。",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

/** D1：主角设定板——左主图 + 右三视图 + 配色/道具细节区（单张 9:16） */
export function composeManhuaHeroCharacterSheetPrompt(input: {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  motiveZh?: string;
  noteZh?: string;
  basePromptZh?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
  topic?: string;
  props?: Array<Pick<ManhuaWriterAssetAnchor, "nameZh" | "lookZh" | "motiveZh">>;
}): string {
  const tag = [input.nameZh, input.aliasZh].filter(Boolean).join("/");
  const look = String(input.lookZh || "").trim();
  const motive = String(input.motiveZh || "").trim();
  const note = String(input.noteZh || "").trim();
  const palette = extractWardrobePaletteTokensZh(look);
  const props = (input.props || []).slice(0, 3);
  const propLines = props
    .map((p) => {
      const detail = [p.lookZh, p.motiveZh].filter(Boolean).join("；");
      return `- ${p.nameZh}${detail ? `：${detail}` : ""}`;
    })
    .join("\n");
  const base = String(input.basePromptZh || "")
    .trim()
    .replace(/原创角色设定卡·?/g, "原创角色定妆设定板，")
    .replace(/设定卡/g, "定妆设定板");

  return [
    "生成一张竖版漫剧「主角定妆设定板」（整图 9:16），版式清晰分区，禁止跨区融合。",
    "布局（画面内禁止姓名条、正面/侧面等文字标签、色号字、UI）：",
    "左区约 45%：主视觉半身或腰上肖像，脸与服化清楚，气质立住。",
    "右上：全身三视图并排（正立面 / 左或右侧立面 / 背面），同一套服装与体型，干净棚拍感背景。",
    "右中或右下：2–4 个服饰/道具细节特写格（发饰、盘扣/护腕、面料纹样、随身物件等）。",
    palette.length
      ? `底部保留一条低调配色条区域，仅用色块表达（勿写色名文字）：${palette.join("、")}。`
      : "底部可留一条低调配色条区域，从服装提取 3–5 个主色色块（勿写色名文字）。",
    "【角色造型参考】",
    `人物气质参考：${tag || "主角"}`,
    look ? `请画出的外形与服化：${look}` : "",
    motive || note
      ? `（隐藏说明·绝不能写成海报句：${[motive, note].filter(Boolean).join("；")}）`
      : "",
    propLines
      ? `随身道具须在三视图或细节格中可读出现：\n${propLines}`
      : "若外形句含佩饰/武器/包袋，须在细节格交代材质与形制。",
    base,
    input.artStyleLabelZh ? `【画风】${input.artStyleLabelZh}` : "",
    String(input.artStylePromptZh || "").trim(),
    input.topic
      ? `（隐藏题材氛围·绝不能写成标题或书法大字：${input.topic.slice(0, 80)}）`
      : "",
    "贯穿全系列同一身份；换脸、换服、换发色会破坏连载锁定。",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 统一选场景 prompt：跨集四视角，否则单张空镜 */
export function resolveManhuaScenePlatePrompt(opts: {
  sceneNameZh: string;
  scenePromptZh: string;
  topic?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
  location?: Pick<ManhuaWriterAssetAnchor, "nameZh" | "aliasZh"> | null;
  episodes?: ManhuaEpisodeBodyRef[] | null;
  buildSingle: (o: {
    sceneNameZh: string;
    scenePromptZh: string;
    topic?: string;
    artStyleLabelZh?: string;
    artStylePromptZh?: string;
  }) => string;
}): { prompt: string; layout: "single" | "grid2x2"; episodeHitCount: number } {
  const loc = opts.location || { nameZh: opts.sceneNameZh };
  const episodeHitCount = countEpisodesMentioningLocation(loc, opts.episodes);
  const useGrid = episodeHitCount >= 2;
  if (useGrid) {
    return {
      prompt: buildManhuaSceneFourViewGridPrompt({
        sceneNameZh: opts.sceneNameZh,
        scenePromptZh: opts.scenePromptZh,
        topic: opts.topic,
        artStyleLabelZh: opts.artStyleLabelZh,
        artStylePromptZh: opts.artStylePromptZh,
        episodeHitCount,
      }),
      layout: "grid2x2",
      episodeHitCount,
    };
  }
  return {
    prompt: opts.buildSingle({
      sceneNameZh: opts.sceneNameZh,
      scenePromptZh: opts.scenePromptZh,
      topic: opts.topic,
      artStyleLabelZh: opts.artStyleLabelZh,
      artStylePromptZh: opts.artStylePromptZh,
    }),
    layout: "single",
    episodeHitCount,
  };
}
