/**
 * 漫剧「编剧室」：题材+短条件 → 可确认的多集剧情包（默认 3 集，2–6 可调）。
 * 前台文案禁止出现模型名 / 供应商 / 「仿写某某」等后台话术。
 */

import {
  composeManhuaPropDemoPromptBlock,
  recommendManhuaContentLanesFromTopic,
} from "./manhuaScenePropDemoCatalog.js";
import { parseWriterTableLine } from "./manhuaWriterAssetCanon.js";
import { buildAncientArchetypePromptBlock } from "./manhuaAncientArchetypeLibrary.js";
import {
  formatPlotPurposeCameraBlock,
  formatScenePacingBlock,
  getManhuaPlotPurposeById,
  getManhuaScenePacingById,
} from "./manhuaPlotPurposeCameraBank.js";
import { formatManhuaViralTemplateWriterAddon } from "./manhuaViralTemplateBank.js";
import {
  formatManhuaEpisodeSegmentPlanBeatsBlock,
  formatManhuaEpisodeSegmentPlanPromptBlock,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "./manhuaEpisodeSegmentPlan.js";
import {
  formatManhuaGlobalStylePromptRequestBlock,
  formatManhuaScreenplayEnginePromptBlock,
} from "./manhuaStoryDistill.js";

export const MANHUA_WRITER_EPISODE_MIN = 2;
export const MANHUA_WRITER_EPISODE_MAX = 6;
export const MANHUA_WRITER_EPISODE_DEFAULT = 3;

export type ManhuaWriterEpisode = {
  index: number;
  title: string;
  /** 本集剧情（含人物场） */
  body: string;
  /** 片尾钩子（必填） */
  endHook: string;
};

export type ManhuaWriterPack = {
  seriesTitle: string;
  logline: string;
  charactersMd: string;
  propsMd: string;
  locationsMd: string;
  episodes: ManhuaWriterEpisode[];
  rawMarkdown: string;
  episodeCount: number;
};

export function clampWriterEpisodeCount(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return MANHUA_WRITER_EPISODE_DEFAULT;
  return Math.max(MANHUA_WRITER_EPISODE_MIN, Math.min(MANHUA_WRITER_EPISODE_MAX, v));
}

/**
 * 注入编导阶段的手法约束（灯光/运镜/情绪）。
 * 内部用；勿把「Skill / 模型」字样暴露给用户 UI。
 */
export const CANVAS_DIRECTOR_CRAFT_PROMPT_BLOCK = `【编导手法约束】
成稿禁止导演名、片名、「向某某致敬」「某某风」。
每集主用 1 种可拍手法语法（灯光+运镜+情绪一致），勿六种硬拼。
优先可拍：景别、运镜、主光/色温/明暗比、环境反馈、微动。
分镜六栏可用：景别｜运镜｜灯光安排｜情绪表达｜画面内容｜台词与音效。
竖屏短片节奏：前三秒钩子（问题/异常/冲突），片尾钩子留给下一集。
剧情发动机写清：目标→阻力→代价；每段须有信息增量；少写心理多写可见动作与道具信息。`;

/** 编剧室扩写 system/user 一体 prompt（给文本生成用） */
export function buildManhuaWriterExpandPrompt(opts: {
  topic: string;
  brief: string;
  episodeCount: number;
  /** 古风原型 arch_* */
  ancientArchetypeIds?: string[];
  plotPurposeId?: string | null;
  scenePacingId?: string | null;
  /** 审定节奏模板 id（tpl_*） */
  viralTemplateId?: string | null;
  /** 若已解析动态库卡片，直接注入（优先于仅 id 查种子库） */
  viralTemplateAddon?: string | null;
  /** 单集时长档位：决定节拍格抽到几拍、密度建议报哪个秒数 */
  lengthTierId?: string | null;
  /** 局部改写：只重写第 N 集起，之前的集不许动 */
  fromEpisode?: number | null;
  /** 集内起点：起点那一集的前 N-1 段剧情必须原样保留 */
  fromSegment?: number | null;
  /** 起点那一集的旧正文；配合 fromSegment 锁住前几段 */
  lockedEpisodeBody?: string | null;
}): string {
  const topic = String(opts.topic || "").trim().slice(0, 500);
  const brief = String(opts.brief || "").trim().slice(0, 2000);
  const n = clampWriterEpisodeCount(opts.episodeCount);
  const propDemo = composeManhuaPropDemoPromptBlock({
    lanes: recommendManhuaContentLanesFromTopic(`${topic}\n${brief}`),
    limit: 4,
  });
  const ancientBlock = buildAncientArchetypePromptBlock(opts.ancientArchetypeIds || []);
  const purpose = getManhuaPlotPurposeById(opts.plotPurposeId);
  const pacing = getManhuaScenePacingById(opts.scenePacingId);
  const viralAddon =
    String(opts.viralTemplateAddon || "").trim() ||
    formatManhuaViralTemplateWriterAddon(opts.viralTemplateId, null, opts.lengthTierId);
  /**
   * 局部改写锁稿：保留段已经出过图、出过片，剧情一旦被改写就和画面对不上。
   * 把旧正文原样交回并要求前几段逐字不动，比事后人工核对便宜得多。
   */
  const from = Math.max(0, Math.floor(Number(opts.fromEpisode) || 0));
  const fromSeg = Math.max(1, Math.floor(Number(opts.fromSegment) || 1));
  const lockedBody = String(opts.lockedEpisodeBody || "").trim().slice(0, 6000);
  const partialBlock =
    from > 0
      ? [
          "",
          "【局部改写】",
          `- 只重写第 ${from} 集及之后；第 1–${from - 1} 集已定稿，本次不要输出改动，但要保持人物关系与既定事实连贯。`,
          ...(fromSeg > 1 && lockedBody
            ? [
                `- 第 ${from} 集的前 ${fromSeg - 1} 段已经出片，剧情必须逐字保留，只从第 ${fromSeg} 段往后改写。`,
                `- 第 ${from} 集旧正文如下，前 ${fromSeg - 1} 段照抄，不得改台词、人物或场景：`,
                "```",
                lockedBody,
                "```",
              ]
            : []),
          "- 新增人物 / 场景 / 道具必须补进对应表，否则后续无法锁定外形。",
        ].join("\n")
      : "";
  return [
    "你是竖屏漫剧连载编剧。根据用户题材与补充条件，扩写成可拍的连载剧情包。",
    "硬规则：",
    "1. 只输出 Markdown，不要代码围栏、不要道歉。",
    "2. 成稿禁止导演名、真实剧集/电影片名、「仿写某某」「致敬某某」。只写可拍的人物关系、权力结构与情绪节奏。",
    "3. 单集目标约 75–90 秒 = 5–6 段 × 约 15 秒（推荐 6 段；预算期勿写满十多段）；对白/场面须撑满密度，禁止寒暄灌水与段间复制粘贴。对白一律用直角引号「」包裹（勿只用弯引号“”）。每段约15秒须至少 3 句「」对白（推荐 3–4 句），并写「表演」栏（表情/肢体/情绪起伏）；禁止两句口号撑满一段。",
    `4. 必须正好输出 ${n} 集；每一集结尾必须有「片尾钩子」（未揭答案、逼观众追下一集）。`,
    "5. 人物 / 道具 / 场景表要具体、可锁定外形与空间，禁止空泛。",
    "6. 道具表可参考下方示范库外观锚点改写，勿照抄剧名；权谋/商战可偏海外可读符号。",
    "7. 若提供古风原型设计板，人物外形与服饰层次须与之对齐。",
    "8. 「系列标题」必须是具体可传播的中文剧名（建议 4–24 字），禁止「未命名」「暂定」「一句话标题」等占位，也禁止只复述题材原文整段。",
    "9. 若提供节奏模板骨架：每集须大体覆盖节拍格冲突类型与场景池关键词，并对白/换场密度不低于模板建议；禁止照抄模板示例成外部剧名。",
    "10. 每一集「本集剧情」之后必须输出完整「五至六段可拍表」（至少段01–段05，推荐到段06），字段见下文模板（含对白+表演）；缺段、缺字段、对白不足 3 句「」、表演过薄视为未完成。人物姓名/场景名必须与人物表·场景表一致，禁止另造皇宫大殿等未立场景。",
    "11. 系列级须输出「整体影像风格」与「统一运镜风格」各一段，供后续静帧/成片共用。",
    "",
    formatManhuaScreenplayEnginePromptBlock(),
    "",
    `【用户题材】${topic || "（未填，请基于补充条件合理拟定）"}`,
    brief ? `【补充条件】\n${brief}` : "【补充条件】（无，请在合理范围内自行补全并保持克制）",
    propDemo,
    ancientBlock,
    purpose ? formatPlotPurposeCameraBlock(purpose) : "",
    pacing ? formatScenePacingBlock(pacing) : "",
    viralAddon,
    partialBlock,
    "",
    "请严格按下列结构输出：",
    "",
    "## 系列标题",
    "（写出正式剧名，勿写说明文字）",
    "",
    "## 一句话系列梗概",
    "（≤40字）",
    "",
    "## 人物表",
    "- 姓名/称呼｜外形锚点｜欲望｜与他人关系｜禁止崩坏点",
    "",
    "## 道具表",
    "- 道具｜叙事作用｜外观锚点",
    "",
    "## 场景表",
    "- 场景｜氛围｜可互动物件",
    "",
    formatManhuaGlobalStylePromptRequestBlock(),
    "",
    ...Array.from({ length: n }, (_, i) => {
      const ep = i + 1;
      return [
        `## 第${ep}集`,
        "### 集标题",
        "### 本集剧情",
        "（冲突、人物场、转折；可分段，勿灌水；须能支撑约 75–90 秒）",
        formatManhuaEpisodeSegmentPlanPromptBlock(),
        "### 片尾钩子",
        "（必须留下未解悬念或关系反转预兆）",
        "",
      ].join("\n");
    }),
  ].join("\n");
}

/** 去掉加粗/书名号等包装，得到可读标题 */
function cleanWriterTitleLine(raw: string): string {
  return String(raw || "")
    .replace(/^[\s>*\-•]+/, "")
    .replace(/\*\*/g, "")
    .replace(/^["「『《]+|["」』》]+$/g, "")
    .replace(/^标题[:：]\s*/i, "")
    .trim();
}

/** 模型偶发输出占位句时视为无效标题 */
export function isPlaceholderSeriesTitle(title: string): boolean {
  const t = cleanWriterTitleLine(title);
  if (!t) return true;
  if (/^未命名/.test(t)) return true;
  if (/^(暂定|待定|无标题|标题待定)$/.test(t)) return true;
  if (/一句话标题|正式剧名|写出剧名|系列标题|勿写说明/.test(t)) return true;
  if (/^[（(].+[）)]$/.test(t) && t.length <= 24) return true;
  return false;
}

/** 题材兜底剧名：优先冒号后短句，否则截题材前段 */
export function deriveSeriesTitleFromTopic(topic: string): string {
  const t = String(topic || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const afterColon = t.split(/[:：]/).slice(1).join("：").trim();
  const candidate =
    afterColon && afterColon.length >= 4 && afterColon.length <= 36 ? afterColon : t;
  return candidate.slice(0, 36);
}

function extractMarkdownSectionLine(md: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sameLine = md.match(new RegExp(`##\\s*${escaped}\\s*[:：]\\s*([^\\n#]+)`, "i"))?.[1];
  if (sameLine) return cleanWriterTitleLine(sameLine);
  const nextLine = md.match(new RegExp(`##\\s*${escaped}\\n+([^\\n#]+)`, "i"))?.[1];
  return cleanWriterTitleLine(nextLine || "");
}

/** 宽松解析扩写 Markdown → 结构（失败时仍保留 raw） */
export function parseManhuaWriterPack(
  raw: string,
  episodeCount: number,
  opts?: { topic?: string },
): ManhuaWriterPack {
  const md = String(raw || "").trim();
  const n = clampWriterEpisodeCount(episodeCount);
  const parsedTitle = extractMarkdownSectionLine(md, "系列标题");
  const topicFallback = deriveSeriesTitleFromTopic(opts?.topic || "");
  const seriesTitle = !isPlaceholderSeriesTitle(parsedTitle)
    ? parsedTitle.slice(0, 48)
    : topicFallback || "未命名系列";
  const logline = extractMarkdownSectionLine(md, "一句话系列梗概").slice(0, 80);
  const charactersMd =
    md.match(/##\s*人物表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";
  const propsMd = md.match(/##\s*道具表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";
  const locationsMd =
    md.match(/##\s*场景表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";

  const episodes: ManhuaWriterEpisode[] = [];
  for (let i = 1; i <= n; i++) {
    const block =
      md.match(new RegExp(`##\\s*第${i}集\\n+([\\s\\S]*?)(?=\\n##\\s*第\\d+集|\\n##\\s[^第]|$)`))?.[1] ||
      "";
    const titleRaw =
      block.match(/###\s*集标题\s*[:：]\s*([^\n#]+)/)?.[1] ||
      block.match(/###\s*集标题\n+([^\n#]+)/)?.[1] ||
      "";
    const title = cleanWriterTitleLine(titleRaw) || `第${i}集`;
    const body =
      block.match(/###\s*本集剧情\n+([\s\S]*?)(?=\n###\s*片尾钩子|$)/)?.[1]?.trim() ||
      block.trim();
    const endHook =
      block.match(/###\s*片尾钩子\n+([\s\S]*?)(?=\n###|\n##|$)/)?.[1]?.trim() || "";
    episodes.push({ index: i, title, body, endHook });
  }

  return {
    seriesTitle,
    logline,
    charactersMd,
    propsMd,
    locationsMd,
    episodes,
    rawMarkdown: md,
    episodeCount: n,
  };
}

/** 按人物/场景名取并集：旧稿在前保设定不变，新稿里没见过的名字追加在后 */
function mergeWriterTableMd(prevMd: string, nextMd: string): string {
  const prevLines = String(prevMd || "").split("\n");
  const nextLines = String(nextMd || "").split("\n");
  if (!prevLines.some((l) => l.trim())) return nextMd;
  const seen = new Set(
    prevLines
      .map((l) => parseWriterTableLine(l)?.nameZh)
      .filter((n): n is string => Boolean(n)),
  );
  const added = nextLines.filter((l) => {
    const name = parseWriterTableLine(l)?.nameZh;
    return Boolean(name) && !seen.has(name!);
  });
  return added.length ? `${prevMd.trimEnd()}\n${added.join("\n")}` : prevMd;
}

/**
 * 从第 fromEpisode 集起换稿：前面的集保留旧正文，从起点往后用新稿。
 *
 * 剧本按集存，没有段级结构，所以拼接的最小粒度就是一集。留下来的集必须连
 * 正文一起留：只留成片不留剧本，后面重跑可拍表就会拿新剧情去对旧画面。
 */
export function spliceManhuaWriterPackFromEpisode(
  prev: ManhuaWriterPack | null | undefined,
  next: ManhuaWriterPack,
  fromEpisode: number,
): ManhuaWriterPack {
  const from = Math.max(1, Math.floor(Number(fromEpisode) || 1));
  if (from <= 1 || !prev?.episodes?.length) return next;
  const keptEpisodes = prev.episodes.filter((e) => e.index < from);
  if (!keptEpisodes.length) return next;
  const rewritten = next.episodes.filter((e) => e.index >= from);
  const episodes = [...keptEpisodes, ...rewritten].sort((a, b) => a.index - b.index);
  /**
   * 资产表取并集，不冻结旧表：扩写本来就会按剧情加人加景，冻住旧表新角色
   * 就进不了人物表，后面资产扫描点名不到，等于没锁脸就开拍。同名以旧稿为准，
   * 保留集里已经出过图的角色不会被改设定。
   */
  return {
    ...next,
    charactersMd: mergeWriterTableMd(prev.charactersMd, next.charactersMd),
    propsMd: mergeWriterTableMd(prev.propsMd, next.propsMd),
    locationsMd: mergeWriterTableMd(prev.locationsMd, next.locationsMd),
    episodes,
    episodeCount: episodes.length,
  };
}

export function writerPackLooksReady(pack: ManhuaWriterPack | null | undefined): boolean {
  if (!pack?.rawMarkdown || pack.rawMarkdown.length < 120) return false;
  if (pack.episodes.length < MANHUA_WRITER_EPISODE_MIN) return false;
  const hooks = pack.episodes.filter((e) => e.endHook.trim().length >= 4);
  return hooks.length >= Math.min(pack.episodes.length, 2);
}

/** 导入已有剧本：字符上限（约 8 万字） */
export const MANHUA_WRITER_IMPORT_MAX_CHARS = 80_000;

export type ManhuaWriterImportResult =
  | { ok: true; pack: ManhuaWriterPack; via: "structured" | "episode_markers" }
  | { ok: false; error: string };

function lastParagraphAsHook(body: string): string {
  const paras = String(body || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = paras[paras.length - 1] || String(body || "").trim();
  const line = last
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return String(line || last).slice(0, 200);
}

function ensureEpisodeHooks(pack: ManhuaWriterPack): ManhuaWriterPack {
  return {
    ...pack,
    episodes: pack.episodes.map((ep) => {
      const hook = ep.endHook.trim();
      if (hook.length >= 4) return ep;
      const derived = lastParagraphAsHook(ep.body);
      return { ...ep, endHook: derived.length >= 4 ? derived : "悬念未揭，下一集见。" };
    }),
  };
}

function extractFreeformSeriesTitle(md: string, topic?: string): string {
  const fromHeading =
    md.match(/^#\s+([^\n#]+)/m)?.[1] ||
    md.match(/^(?:剧名|系列标题|片名)\s*[:：]\s*([^\n]+)/m)?.[1] ||
    "";
  const cleaned = cleanWriterTitleLine(fromHeading);
  if (!isPlaceholderSeriesTitle(cleaned)) return cleaned.slice(0, 48);
  const topicFallback = deriveSeriesTitleFromTopic(topic || "");
  if (topicFallback) return topicFallback;
  const firstLine = cleanWriterTitleLine(md.split("\n").find((l) => l.trim()) || "");
  if (firstLine && firstLine.length <= 36 && !/^第\s*\d+\s*集/.test(firstLine)) {
    return firstLine.slice(0, 48);
  }
  return "导入剧本";
}

type MarkedEpisode = { index: number; title: string; body: string };

function splitByEpisodeMarkers(md: string): MarkedEpisode[] {
  const re = /(?:^|\n)(?:#{1,3}\s*)?第\s*(\d+)\s*集\s*[：:\-—–]?\s*([^\n]*)/g;
  const hits: Array<{ index: number; title: string; start: number; headerEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const index = Math.floor(Number(m[1]));
    if (!Number.isFinite(index) || index < 1) continue;
    const header = m[0];
    const start = m.index + (header.startsWith("\n") ? 1 : 0);
    const headerEnd = m.index + header.length;
    hits.push({
      index,
      title: cleanWriterTitleLine(m[2] || "") || `第${index}集`,
      start,
      headerEnd,
    });
  }
  if (hits.length < MANHUA_WRITER_EPISODE_MIN) return [];
  hits.sort((a, b) => a.start - b.start);
  const out: MarkedEpisode[] = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!;
    const nextStart = hits[i + 1]?.start ?? md.length;
    const body = md.slice(cur.headerEnd, nextStart).trim();
    if (body.length < 8) continue;
    out.push({ index: cur.index, title: cur.title, body });
  }
  return out;
}

function extractHookFromEpisodeBody(body: string): { body: string; endHook: string } {
  const hookMatch =
    body.match(/(?:^|\n)(?:#{2,4}\s*)?(?:片尾钩子|结尾钩子|钩子)\s*[:：]?\s*\n+([\s\S]*?)$/i) ||
    body.match(/(?:^|\n)(?:片尾钩子|结尾钩子|钩子)\s*[:：]\s*([^\n]+)/i);
  if (hookMatch) {
    const endHook = String(hookMatch[1] || "").trim();
    const bodyOnly = body.slice(0, hookMatch.index).trim();
    return {
      body: bodyOnly || body.trim(),
      endHook: endHook.length >= 4 ? endHook.slice(0, 200) : lastParagraphAsHook(bodyOnly || body),
    };
  }
  return { body: body.trim(), endHook: lastParagraphAsHook(body) };
}

/**
 * 导入已有剧本（粘贴 / .txt / .md）→ 编剧包。
 * 优先识别平台扩写结构；否则要求文中含「第N集」分集标记。
 */
export function importManhuaWriterPackFromText(
  raw: string,
  opts?: { topic?: string; episodeCount?: number },
): ManhuaWriterImportResult {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (text.length < 80) {
    return { ok: false, error: "文本太短，请粘贴完整分集剧本（至少两集，建议含「第1集」「第2集」）" };
  }
  if (text.length > MANHUA_WRITER_IMPORT_MAX_CHARS) {
    return { ok: false, error: "文本过长，请控制在约 8 万字以内，或先拆成系列大纲再导入" };
  }

  const topic = String(opts?.topic || "").trim();
  const looksStructured =
    /##\s*系列标题/.test(text) || (/###\s*本集剧情/.test(text) && /##\s*第\s*\d+\s*集/.test(text));

  if (looksStructured) {
    const markedCount = (text.match(/##\s*第\s*\d+\s*集/g) || []).length;
    const n = clampWriterEpisodeCount(
      markedCount >= MANHUA_WRITER_EPISODE_MIN
        ? markedCount
        : opts?.episodeCount || MANHUA_WRITER_EPISODE_DEFAULT,
    );
    const structured = ensureEpisodeHooks(parseManhuaWriterPack(text, n, { topic }));
    const solid = structured.episodes.filter((e) => e.body.trim().length >= 8);
    if (solid.length >= MANHUA_WRITER_EPISODE_MIN && writerPackLooksReady({
      ...structured,
      episodes: solid,
      episodeCount: solid.length,
      rawMarkdown: text,
    })) {
      return {
        ok: true,
        pack: {
          ...structured,
          episodes: solid.slice(0, MANHUA_WRITER_EPISODE_MAX).map((e, i) => ({
            ...e,
            index: i + 1,
          })),
          episodeCount: Math.min(solid.length, MANHUA_WRITER_EPISODE_MAX),
        },
        via: "structured",
      };
    }
  }

  const marked = splitByEpisodeMarkers(text);
  if (marked.length < MANHUA_WRITER_EPISODE_MIN) {
    return {
      ok: false,
      error: "未能识别分集。请用「第1集」「第2集」标出至少两集，或粘贴平台扩写格式的剧情包。",
    };
  }

  const n = clampWriterEpisodeCount(
    Math.min(marked.length, opts?.episodeCount || marked.length, MANHUA_WRITER_EPISODE_MAX),
  );
  const picked = marked
    .slice()
    .sort((a, b) => a.index - b.index)
    .slice(0, n);
  const episodes: ManhuaWriterEpisode[] = picked.map((ep, i) => {
    const split = extractHookFromEpisodeBody(ep.body);
    return {
      index: i + 1,
      title: ep.title || `第${i + 1}集`,
      body: split.body,
      endHook: split.endHook.length >= 4 ? split.endHook : "悬念未揭，下一集见。",
    };
  });

  const seriesTitle = extractFreeformSeriesTitle(text, topic);
  const logline =
    cleanWriterTitleLine(
      text.match(/(?:^|\n)(?:梗概|一句话|logline)\s*[:：]\s*([^\n]+)/i)?.[1] || "",
    ).slice(0, 80) || "";
  const charactersMd =
    text.match(/##\s*人物表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";
  const propsMd = text.match(/##\s*道具表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";
  const locationsMd =
    text.match(/##\s*场景表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";

  const pack = ensureEpisodeHooks({
    seriesTitle,
    logline,
    charactersMd,
    propsMd,
    locationsMd,
    episodes,
    rawMarkdown: text,
    episodeCount: episodes.length,
  });

  if (!writerPackLooksReady(pack)) {
    return { ok: false, error: "已识别分集，但内容过短或不完整，请补全每集正文后再导入" };
  }

  return { ok: true, pack, via: "episode_markers" };
}

/** 确认进编导后，灌进工厂故事/角色/节拍的上下文块 */
export function composeWriterPackFactoryContext(
  pack: ManhuaWriterPack,
  focusEpisode = 1,
  opts?: { assetCanonAddonZh?: string | null },
): string {
  const ep = pack.episodes.find((e) => e.index === focusEpisode) || pack.episodes[0];
  const addon = String(opts?.assetCanonAddonZh || "").trim();
  const segmentPlan = ep
    ? parseManhuaEpisodeSegmentPlanFromMarkdown(ep.body || "")
    : null;
  const segmentBlock = formatManhuaEpisodeSegmentPlanBeatsBlock(segmentPlan);
  return [
    "【已确认编剧包·强制遵守】",
    `系列：${pack.seriesTitle}`,
    pack.logline ? `梗概：${pack.logline}` : "",
    addon,
    "",
    "## 人物表",
    pack.charactersMd || "（见原文）",
    "",
    "## 道具表",
    pack.propsMd || "（见原文）",
    "",
    "## 场景表",
    pack.locationsMd || "（见原文）",
    "",
    ep
      ? [
          `## 本集优先：第${ep.index}集《${ep.title}》`,
          ep.body,
          segmentBlock,
          `片尾钩子：${ep.endHook}`,
          "本轮制作先兑现这一集（约 5–6 段×15 秒）；钩子留给下一集，勿在本集拍穿。",
          "人物/道具用系列表锁定；本集主场景见资产真源，可切场景池其他地点但须有过渡。",
          "节拍/静帧/成片须对齐五至六段可拍表字段；每段 3–4 张关键静帧锁定后再出视频。",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
