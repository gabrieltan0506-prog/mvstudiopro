/**
 * 漫剧「编剧室」：题材+短条件 → 可确认的多集剧情包（默认 3 集，2–6 可调）。
 * 前台文案禁止出现模型名 / 供应商 / 「仿写某某」等后台话术。
 */

import {
  composeManhuaPropDemoPromptBlock,
  recommendManhuaContentLanesFromTopic,
} from "./manhuaScenePropDemoCatalog.js";
import { buildAncientArchetypePromptBlock } from "./manhuaAncientArchetypeLibrary.js";
import {
  formatPlotPurposeCameraBlock,
  formatScenePacingBlock,
  getManhuaPlotPurposeById,
  getManhuaScenePacingById,
} from "./manhuaPlotPurposeCameraBank.js";
import { formatManhuaViralTemplateWriterAddon } from "./manhuaViralTemplateBank.js";

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
    formatManhuaViralTemplateWriterAddon(opts.viralTemplateId);
  return [
    "你是竖屏漫剧连载编剧。根据用户题材与补充条件，扩写成可拍的连载剧情包。",
    "硬规则：",
    "1. 只输出 Markdown，不要代码围栏、不要道歉。",
    "2. 成稿禁止导演名、真实剧集/电影片名、「仿写某某」「致敬某某」。只写可拍的人物关系、权力结构与情绪节奏。",
    "3. 默认竖屏短剧单次成片严格按 10 秒可拍密度；本阶段先写剧情与设定，不写镜头表。",
    `4. 必须正好输出 ${n} 集；每一集结尾必须有「片尾钩子」（未揭答案、逼观众追下一集）。`,
    "5. 人物 / 道具 / 场景表要具体、可锁定外形与空间，禁止空泛。",
    "6. 道具表可参考下方示范库外观锚点改写，勿照抄剧名；权谋/商战可偏海外可读符号。",
    "7. 若提供古风原型设计板，人物外形与服饰层次须与之对齐。",
    "8. 「系列标题」必须是具体可传播的中文剧名（建议 4–24 字），禁止「未命名」「暂定」「一句话标题」等占位，也禁止只复述题材原文整段。",
    "9. 若提供节奏模板骨架：每集须大体覆盖节拍格冲突类型与场景池关键词，并对白/换场密度不低于模板建议；禁止照抄模板示例成外部剧名。",
    "",
    `【用户题材】${topic || "（未填，请基于补充条件合理拟定）"}`,
    brief ? `【补充条件】\n${brief}` : "【补充条件】（无，请在合理范围内自行补全并保持克制）",
    propDemo,
    ancientBlock,
    purpose ? formatPlotPurposeCameraBlock(purpose) : "",
    pacing ? formatScenePacingBlock(pacing) : "",
    viralAddon,
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
    ...Array.from({ length: n }, (_, i) => {
      const ep = i + 1;
      return [
        `## 第${ep}集`,
        "### 集标题",
        "### 本集剧情",
        "（冲突、人物场、转折；可分段，勿灌水）",
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
          `片尾钩子：${ep.endHook}`,
          "本轮制作先兑现这一集；钩子留给下一集，勿在本集拍穿。",
          "人物/道具用系列表锁定；本集主场景见资产真源，可切场景池其他地点但须有过渡。",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
