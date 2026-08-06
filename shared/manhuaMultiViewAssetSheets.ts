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

/**
 * C：主角（男女主级）判定——只有主角出「脸特写 + 全身」两张锁 ID；
 * 配角/群像出单张全身即可（用户口径：主角多图、配角单图）。
 *
 * 主角来源优先级：
 * 1) 显式指定（男女主 explicitLeadIds，来自角色偏好里选定的主角）；
 * 2) 否则按跨集正文提及次数排序，取前 maxLeads 名（默认 2）为主角。
 * 提及为 0 的不算主角。名字/别名都计数。
 */
export function resolveManhuaLeadCharacterIds(
  characters: Array<Pick<ManhuaWriterAssetAnchor, "id" | "nameZh" | "aliasZh">> | null | undefined,
  episodes: ManhuaEpisodeBodyRef[] | null | undefined,
  opts?: { explicitLeadIds?: Array<string | null | undefined> | null; maxLeads?: number },
): Set<string> {
  const chars = (characters || []).filter((c) => c && c.id);
  if (!chars.length) return new Set();
  const maxLeads = Math.max(1, Math.floor(opts?.maxLeads ?? 2));

  // 1) 显式男女主：命中 canon 的直接采用
  const explicit = (opts?.explicitLeadIds || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (explicit.length) {
    const byId = new Set(chars.map((c) => c.id));
    const hit = explicit.filter((id) => byId.has(id));
    if (hit.length) return new Set(hit.slice(0, maxLeads));
  }

  // 2) 跨集提及次数排序
  const bodies = (episodes || [])
    .map((e) => `${e.title || ""}\n${e.body || ""}`)
    .join("\n");
  if (!bodies.trim()) {
    // 无正文可数：退化为人物表前 maxLeads 名（保持稳定，不空）
    return new Set(chars.slice(0, maxLeads).map((c) => c.id));
  }
  const scored = chars.map((c, i) => {
    const needles = [c.nameZh, c.aliasZh]
      .map((s) => String(s || "").trim())
      .filter((s) => s.length >= 2);
    let count = 0;
    for (const n of needles) count += bodies.split(n).length - 1;
    return { id: c.id, count, order: i };
  });
  scored.sort((a, b) => b.count - a.count || a.order - b.order);
  return new Set(
    scored.filter((s) => s.count > 0).slice(0, maxLeads).map((s) => s.id),
  );
}

/**
 * 剧本性别硬锁：从人物表自动读出性别，写进设定图提示词。
 *
 * 根因（用户 2026-07-29 验收）：设定图提示词只写「二十四岁、长发、杏眼、劲装」这类
 * 中性外形，一个字没提性别 → 武侠劲装角色会被画成男相，主角脸特写与全身图各画各的，
 * 就出现「全身是女、脸特写是男」。剧本里明写「陆镇渊之女、沈沧澜恋人」，系统就该自己读出来。
 *
 * 只认**描述本角色自身**的强特征（`X之女`／`X之子`／`公子`／`姑娘`…）；
 * 刻意不收「父亲/母亲/兄/弟/姐/妹」——那些多半在讲别人（「被父亲当作继承人培养」
 * 里的父亲是她爹，不是她），收了会把女主判成男。
 */
const SELF_FEMALE_STRONG_RE =
  /之女|嫡女|独女|长女|次女|之母|姑娘|少女|女子|女侠|女将|女官|皇后|太后|贵妃|王妃|妃子|公主|郡主|夫人|小姐|她/g;
// 刻意不收「王爷/摄政王/将军」这类头衔：多半在讲角色效忠的对象
// （「摄政王亲兵」里的摄政王是别人），收了会把亲兵、侍女判成男。
const SELF_MALE_STRONG_RE = /之子|嫡子|独子|长子|次子|之父|公子|少爷|男子|太子|世子|皇子|他/g;
/** 弱信号：仅在强信号打平或缺失时用来定夺 */
const WEAK_FEMALE_RE = /裙|钗|簪|胭脂|柳眉|杏眼|婢|绣/g;
const WEAK_MALE_RE = /短须|胡须|髭|喉结|盟弟|盟兄/g;

function countRe(blob: string, re: RegExp): number {
  const m = blob.match(re);
  return m ? m.length : 0;
}

/**
 * 按剧本推断角色性别；判不出返回 null（此时提示词不写性别，绝不瞎猜）。
 */
export function inferManhuaCharacterGenderZh(
  character: Pick<
    ManhuaWriterAssetAnchor,
    "nameZh" | "aliasZh" | "lookZh" | "motiveZh" | "noteZh"
  >,
): "女" | "男" | null {
  const blob = [
    character.nameZh,
    character.aliasZh,
    character.lookZh,
    character.motiveZh,
    character.noteZh,
  ]
    .map((s) => String(s || ""))
    .join("；")
    // 「其他/他们/他人/她们」不是性别信号，先剔掉免得干扰
    .replace(/其他|他们|他人|她们/g, "");
  if (!blob.trim()) return null;
  const f = countRe(blob, SELF_FEMALE_STRONG_RE);
  const m = countRe(blob, SELF_MALE_STRONG_RE);
  if (f > m) return "女";
  if (m > f) return "男";
  const wf = countRe(blob, WEAK_FEMALE_RE);
  const wm = countRe(blob, WEAK_MALE_RE);
  if (wf > wm) return "女";
  if (wm > wf) return "男";
  return null;
}

/** 性别硬锁句：没读出性别就返回空串，不瞎写 */
function genderLockLineZh(
  genderZh: "女" | "男" | null | undefined,
  scope: "face" | "body",
): string {
  if (genderZh !== "女" && genderZh !== "男") return "";
  const other = genderZh === "女" ? "男" : "女";
  if (scope === "face") {
    return `性别硬锁：本角色是${genderZh}性——脸型、五官、眉眼与气质须明确读作${genderZh}性，禁止画成${other}性或中性难辨。`;
  }
  return `性别硬锁：本角色是${genderZh}性——身形比例与服装版型须为${genderZh}性，禁止画成${other}性。`;
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

/**
 * 与角色相关的道具：名称/备注/功能命中角色名才收；不命中就是空——
 * 不拿系列前几件瞎凑。凑出来的道具会被 `stampManhuaSheetPropSubTagsOnPrompt`
 * 写进定妆卡 prompt 变成模型眼里的「事实」，宁可这张卡没有道具特写，
 * 也不能把不相关的道具锁给不相关的角色。
 */
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
  return related.slice(0, limit);
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

/**
 * D1-a：主角大头照——只有脸，专供引擎锁 ID。
 *
 * 官方「人物 ID 漂移」根因第一条就是参考图混用：把人脸、全身姿态、服装、
 * 细节格拼在同一张里，模型会把同一个人的不同角度认成好几个主体，画面里
 * 因此冒出两个一模一样的人。解法是大头照 + 全身照分开两张。
 */
export function composeManhuaHeroFaceCloseupPrompt(input: {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  /** 剧本读出的性别；缺省则不写性别句 */
  genderZh?: "女" | "男" | null;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
}): string {
  const tag = [input.nameZh, input.aliasZh].filter(Boolean).join("/");
  const look = String(input.lookZh || "").trim();
  return [
    "生成一张竖版（9:16）单人「面部特征参考图」：只画头部大特写，正面平视，占画面主体。",
    "仅保留面部与发型轮廓；肩颈只留极少，背景纯净单色或极浅景深，禁止任何环境陈设。",
    "表情中性、无夸张情绪，眼睛看镜头——供后续视频锁定同一张脸，不是表演定妆。",
    "只能有一个人；禁止三视图、禁止多角度并排、禁止分格拼版、禁止侧脸背面小图。",
    genderLockLineZh(input.genderZh, "face"),
    look ? `五官与发型依据：${look}` : "",
    `（隐藏身份·不必画出：${tag || "主角"}）`,
    input.artStyleLabelZh ? `【画风】${input.artStyleLabelZh}` : "",
    String(input.artStylePromptZh || "").trim(),
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * D1-b：主角全身妆造照——单人独立全身，专供引擎锁服化。
 *
 * 服饰道具的形制材质写进提示词文本，不再另开细节特写格：那些格子就是
 * 官方点名的「参考图混用」，会把服装图和人脸图挤在一张里互相干扰。
 */
export function composeManhuaHeroFullBodyLookPrompt(input: {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  /** 剧本读出的性别；缺省则不写性别句 */
  genderZh?: "女" | "男" | null;
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
  const propLines = (input.props || [])
    .slice(0, 3)
    .map((p) => {
      const detail = [p.lookZh, p.motiveZh].filter(Boolean).join("；");
      return `- ${p.nameZh}${detail ? `：${detail}` : ""}`;
    })
    .join("\n");
  const base = String(input.basePromptZh || "")
    .trim()
    .replace(/原创角色设定卡·?/g, "原创角色全身定妆，")
    .replace(/设定卡/g, "全身定妆");
  return [
    "生成一张竖版（9:16）单人「全身妆造参考图」：一个人、一个正面站姿、全身入画，从头到脚完整。",
    "干净棚拍感背景，光线均匀让服装款式与材质看得清；姿态自然放松，不做大动作。",
    "只能有一个人、只有一个角度；禁止三视图、禁止正侧背并排、禁止分格拼版、禁止另加细节特写小图。",
    genderLockLineZh(input.genderZh, "body"),
    look ? `请画出的外形与服化：${look}` : "",
    palette.length ? `服装主色调：${palette.join("、")}。` : "",
    propLines
      ? `随身道具须穿戴/持握在身上并看得出材质形制：\n${propLines}`
      : "若外形句含佩饰、武器、包袋，须穿戴在身上并看得出材质形制。",
    motive || note
      ? `（隐藏说明·绝不能写成海报句：${[motive, note].filter(Boolean).join("；")}）`
      : "",
    `（隐藏身份·不必画出：${tag || "主角"}）`,
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

/**
 * D1-c（A 方案 · 用户 2026-07-29 选定）：脸特写**从已出的全身图**裁切放大得来，
 * 不再独立重画一张脸。
 *
 * 为什么改：脸特写与全身图原先是两次互不参考的独立生成，连性别都能漂
 * （陆清和「全身是女、脸特写是男」）。改成以全身图为唯一依据后，脸天然是同一张，
 * 又保留「单出一张高清大头照供引擎锁 ID」的好处——全身图里脸只占很小像素，
 * 直接拿全身图锁脸并不稳。
 *
 * 调用方须把该角色的全身图作为参考图/改图底图传入，本函数只产文本指令。
 */
export function composeManhuaHeroFaceFromBodyPrompt(input: {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  genderZh?: "女" | "男" | null;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
}): string {
  const tag = [input.nameZh, input.aliasZh].filter(Boolean).join("/");
  const look = String(input.lookZh || "").trim();
  return [
    "以参考图中的人物为唯一依据，输出一张竖版（9:16）「面部特征参考图」：把其头部裁切并放大到占画面主体，正面平视。",
    "身份硬锁：必须与参考图是同一个人——五官比例、脸型、眉眼、发型、发色、肤色、妆造一律照搬，禁止重新设计脸、禁止换人、禁止美颜改骨相。",
    "只保留面部与发型轮廓；肩颈只留极少，背景换成纯净单色或极浅景深，去掉全身服装与环境陈设。",
    "表情中性、无夸张情绪，眼睛看镜头——供后续视频锁定同一张脸。",
    "只能有一个人；禁止三视图、禁止多角度并排、禁止分格拼版、禁止另加侧脸背面小图。",
    genderLockLineZh(input.genderZh, "face"),
    look ? `（比对用外形依据·不得据此改脸：${look}）` : "",
    `（隐藏身份·不必画出：${tag || "主角"}）`,
    input.artStyleLabelZh ? `【画风】${input.artStyleLabelZh}` : "",
    String(input.artStylePromptZh || "").trim(),
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * D1（旧）：主角设定板——左主图 + 右三视图 + 配色/道具细节区（单张 9:16）。
 *
 * @deprecated 三视图 + 细节格拼版正是官方「ID 漂移」根因（参考图混用），
 * 出片一律改用 composeManhuaHeroFaceCloseupPrompt + FullBodyLookPrompt 两张。
 * 仅保留给「给人看的设定板」这类非引擎用途。
 */
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
