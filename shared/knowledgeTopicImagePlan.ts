/**
 * 图文知识手册的出图规划（用户 2026-11-08 改令）：
 * - 每张图 = 一个章节/主题的核心图解；图内文字 ≤ 1200 中文字（KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE）。
 * - 图数由主题/章节数决定，不按字数切：相邻小节按篇幅合并成主题；档位只以图片张数区分：
 *   精华版 = 图片 ≤30 张，超过 30 张即为完整版（完整版硬顶 48，用户 2026-11-09 改令，取代原 16/8）。
 * - 图外的全部细节（溢出文字）进入该主题的内文（图在上、要点在下，续页接排），内文不受 1200 限制。
 * - 图与内文互不重复：每段文字要么进图、要么进内文，按原顺序切分，不复制。
 *
 * 旧逻辑把全部图解模块按 1200 字装页，敦煌完整版因此排出 82 张图（2344 积分）、0 页内文。
 */
import type { KnowledgeEditionLevel } from "./knowledgeEditionBudget";

/** 单张图内文字上限（与出图分页上限同值；这里独立声明避免与分页模块循环依赖）。 */
export const KNOWLEDGE_TOPIC_IMAGE_MAX_CHARS = 1200;
/** 每档图片张数硬顶（用户 2026-11-09 改令）：精华版 ≤30 张；超过 30 张即为完整版，完整版硬顶 48（血脂 v2 基准即 48 张）。 */
export const KNOWLEDGE_TOPIC_IMAGE_CAP: Record<KnowledgeEditionLevel, number> = { full: 48, concise: 30 };
/** 精华/完整只以图片张数区分：≤30 张为精华版，否则为完整版。 */
export const knowledgeEditionLevelForImageCount = (images: number): KnowledgeEditionLevel => (images <= KNOWLEDGE_TOPIC_IMAGE_CAP.concise ? "concise" : "full");
/** 合并后每个主题至少承载的原文字数；不足一张图的相邻小节合并为同一主题。 */
export const KNOWLEDGE_TOPIC_MIN_CHARS = 1200;
/** 每个小节在图内至少保留的要点字数（标题之外），避免多节合并时只剩标题。 */
const MODULE_MIN_GIST = 40;
/** 一张图最多展开几个小节要点；其余小节只列名，全文进内文（图解要清楚，不塞成目录墙）。 */
export const KNOWLEDGE_TOPIC_MAX_GIST_SECTIONS = 8;

export type KnowledgeTopicModule = { headline: string; body: string };
export type KnowledgeTopicImage = {
  /** 本图包含的原小节标题（按原顺序）。 */
  headlines: string[];
  /** 图片主题标题（模型命题，失败时为机械标题）。 */
  title: string;
  /** 图下内文（含续页）的标题；无模型命题时同图片标题。 */
  readingTitle: string;
  /** 送去出图的图内文字，长度 ≤ 1200。 */
  body: string;
  /** 图外细节：未进图的原文（按原顺序），放到本图下方要点与续页内文。 */
  overflow: string;
};

const visibleChars = (s: string) => s.replace(/\s+/g, "").length;
const isTable = (p: string) => {
  const lines = p.split(/\r?\n/);
  return lines.length > 1 && lines[0]!.includes("|") && /^\s*\|?\s*:?-+:?\s*\|/.test(lines[1]!);
};

/** 相邻小节按篇幅做连续划分，使各主题字数尽量均衡（最小化最大组）。 */
export function partitionKnowledgeTopics(weights: readonly number[], groups: number): number[][] {
  const n = weights.length;
  const k = Math.max(1, Math.min(groups, n));
  if (!n) return [];
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1]! + Math.max(1, w));
  const sum = (a: number, b: number) => prefix[b]! - prefix[a]!;
  // cost[j][i]：前 i 个小节分成 j 组时的最大组字数
  const cost: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  cost[0]![0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let p = j - 1; p < i; p++) {
        const value = Math.max(cost[j - 1]![p]!, sum(p, i));
        if (value < cost[j]![i]!) { cost[j]![i] = value; cut[j]![i] = p; }
      }
    }
  }
  const result: number[][] = [];
  let end = n;
  for (let j = k; j >= 1; j--) {
    const start = cut[j]![end]!;
    result.unshift(Array.from({ length: end - start }, (_, x) => start + x));
    end = start;
  }
  return result;
}

/** 主题张数：按合并后的主题数，再受档位硬顶约束。 */
export function knowledgeTopicImageCount(level: KnowledgeEditionLevel, modules: readonly KnowledgeTopicModule[]) {
  const usable = modules.filter(m => visibleChars(m.body) || m.headline.trim());
  if (!usable.length) return 0;
  const total = usable.reduce((n, m) => n + visibleChars(m.body), 0);
  const byVolume = Math.max(1, Math.ceil(total / KNOWLEDGE_TOPIC_MIN_CHARS));
  return Math.min(KNOWLEDGE_TOPIC_IMAGE_CAP[level], usable.length, byVolume);
}

/** 从一个段落取前若干完整句/行，返回放进图的部分与剩余部分；表格整行切分并为剩余部分补回表头。 */
function splitParagraph(p: string, room: number): [string, string] {
  if (p.length <= room) return [p, ""];
  if (isTable(p)) {
    const lines = p.split(/\r?\n/);
    const head = lines.slice(0, 2);
    let taken = head.join("\n").length;
    if (taken >= room) return ["", p];
    let i = 2;
    while (i < lines.length && taken + 1 + lines[i]!.length <= room) { taken += 1 + lines[i]!.length; i++; }
    if (i === 2) return ["", p];
    return [lines.slice(0, i).join("\n"), i < lines.length ? [...head, ...lines.slice(i)].join("\n") : ""];
  }
  const pieces = p.match(/[^。！？；\n]+[。！？；]?\n?|[。！？；\n]+/g) || [p];
  let taken = "";
  let i = 0;
  while (i < pieces.length && taken.length + pieces[i]!.length <= room) taken += pieces[i++];
  if (!taken.trim()) return ["", p];
  return [taken.trim(), pieces.slice(i).join("").trim()];
}

/** 按原顺序把小节正文切成「进图要点」与「图外细节」，图内部分不超过 budget 字。 */
function splitModuleGist(body: string, budget: number): { gist: string; rest: string } {
  const paragraphs = body.trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const gist: string[] = [], rest: string[] = [];
  let room = budget;
  let closed = false;
  for (const p of paragraphs) {
    if (closed || room <= 0) { rest.push(p); continue; }
    const [take, left] = splitParagraph(p, room);
    if (take) { gist.push(take); room -= take.length + 2; }
    // 段落只进了一半时停止取后文，保证内文从断点接续；整段装不下（如大表）则整段转内文，继续看下一段。
    if (left) { rest.push(left); if (take) closed = true; }
  }
  return { gist: gist.join("\n\n"), rest: rest.join("\n\n") };
}

/** 机械标题：模型命题失败或主题划分已变化时的兜底。 */
export function mechanicalKnowledgeTopicTitle(headlines: readonly string[]) {
  if (headlines.length === 1) return headlines[0]!;
  return `${headlines[0]}（等${headlines.length}节）`;
}

/** 主题身份 = 所含小节标题序列；划分变化时旧标题自动失效。 */
export const knowledgeTopicKey = (headlines: readonly string[]) => headlines.map(h => h.trim()).join("｜");

/** 模型命名的主题标题以隐藏注释存于两档原稿首部，供同步分页/计价/出图共用；不进入正文。 */
const TOPIC_TITLES_COMMENT = /<!-- knowledge-topic-titles:v1 (\{[\s\S]*?\}) -->\n?/;
/** 每个主题：图片标题、图下内文标题，以及按原小节标题对应的内文小标题。 */
export type KnowledgeTopicTitle = { image?: string; reading?: string; sections?: Record<string, string> };
export type KnowledgeTopicTitles = Record<string, KnowledgeTopicTitle>;
/** 模型照抄格式说明里的字段名（1108g2 实测全部回“图片标题/图下内文标题”）视为未命题，回退机械标题。 */
export const KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER = /^(?:图片标题|图下内文标题|内文标题|该节内文小标题|内文小标题|小节标题|主题标题|主题命题|标题|title)$/i;
const cleanTitle = (v: unknown) => typeof v === "string" && v.trim() && !/[\n#]/.test(v) && v.trim().length <= 40
  && !KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER.test(v.trim()) ? v.trim() : undefined;
export function readKnowledgeTopicTitles(markdown: string): KnowledgeTopicTitles {
  const raw = String(markdown || "").match(TOPIC_TITLES_COMMENT)?.[1];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const out: KnowledgeTopicTitles = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      if (!value || typeof value !== "object") continue;
      const v = value as any;
      const sections = Object.fromEntries(Object.entries(v.sections || {}).flatMap(([k, t]) => (cleanTitle(t) ? [[k, cleanTitle(t)!]] : [])));
      out[key] = { image: cleanTitle(v.image), reading: cleanTitle(v.reading), sections };
    }
    return out;
  } catch { return {}; }
}
export function stripKnowledgeTopicTitles(markdown: string) {
  return String(markdown || "").replace(TOPIC_TITLES_COMMENT, "");
}
/** 写入（或替换）标题注释，紧跟两档标记行；JSON 中的 `-->` 已转义，不会提前闭合注释。 */
export function embedKnowledgeTopicTitles(markdown: string, titles: KnowledgeTopicTitles) {
  const clean = stripKnowledgeTopicTitles(markdown);
  if (!Object.keys(titles).length) return clean;
  const comment = `<!-- knowledge-topic-titles:v1 ${JSON.stringify(titles).replace(/-->/g, "--\\u003e")} -->\n`;
  const marker = clean.match(/^<!-- knowledge-edition:v2:(?:full|concise) -->\s*\n?/);
  return marker ? marker[0] + comment + clean.slice(marker[0].length) : comment + clean;
}

/**
 * 规划主题图：返回每张图的图内文字与图外细节。
 * title 为整册标题；空间允许时每张图首行保留 `# 标题`，与旧分页切片格式一致。
 */
export function planKnowledgeTopicImages(
  level: KnowledgeEditionLevel,
  title: string,
  modules: readonly KnowledgeTopicModule[],
  maxChars = KNOWLEDGE_TOPIC_IMAGE_MAX_CHARS,
  titles: KnowledgeTopicTitles = {},
): KnowledgeTopicImage[] {
  const usable = modules.filter(m => visibleChars(m.body) || m.headline.trim());
  const count = knowledgeTopicImageCount(level, usable);
  if (!count) return [];
  const groups = partitionKnowledgeTopics(usable.map(m => visibleChars(m.body)), count);
  return groups.map(indices => {
    const members = indices.map(i => usable[i]!);
    const headlines = members.map(m => m.headline.trim());
    const named = titles[knowledgeTopicKey(headlines)] || {};
    const imageTitle = named.image || mechanicalKnowledgeTopicTitle(headlines);
    const readingTitle = named.reading || imageTitle;
    // 小节标题：模型命名优先，缺项回退原标题；图内小标题与内文小标题一致。
    const heading = (h: string) => named.sections?.[h.trim()] || h.trim();
    const header = `${title.length + 4 < maxChars / 8 ? `# ${title}\n\n` : ""}## ${imageTitle}`;
    // 篇幅最大的若干节展开要点（保持原顺序），其余只在图内列名。
    const ranked = members.map((m, i) => ({ i, n: visibleChars(m.body) })).sort((a, b) => b.n - a.n || a.i - b.i);
    const shown = new Set(ranked.slice(0, KNOWLEDGE_TOPIC_MAX_GIST_SECTIONS).filter(r => r.n > 0).map(r => r.i));
    const listed = members.filter((_, i) => !shown.has(i)).map(m => heading(m.headline));
    const listLine = listed.length ? `本主题另含：${listed.join("、")}（详见内文）` : "";
    const multi = members.length > 1;
    const fixed = header.length + (listLine ? listLine.length + 2 : 0)
      + members.reduce((n, m, i) => n + (shown.has(i) ? (multi ? heading(m.headline).length + 6 : 0) + 2 : 0), 0);
    const room = Math.max(0, maxChars - fixed);
    const lengths = members.map((m, i) => (shown.has(i) ? m.body.trim().length : 0));
    const budgets = members.map(() => 0);
    const grantSpare = (spare: number, open: number[]) => {
      // 按 √字数 分配：长节多给、短节也有一句；单节不超过原文长度，余量回流给其他节。
      let left = spare;
      while (left > 0 && open.length) {
        const weight = open.reduce((n, i) => n + Math.sqrt(lengths[i]!), 0);
        let spent = 0;
        for (const i of open) {
          const share = Math.max(Math.min(MODULE_MIN_GIST, left), Math.floor(left * Math.sqrt(lengths[i]!) / weight));
          const grant = Math.max(0, Math.min(share, lengths[i]! - budgets[i]!, left - spent));
          budgets[i]! += grant; spent += grant;
        }
        left -= spent;
        open = open.filter(i => budgets[i]! < lengths[i]!);
        if (!spent) break;
      }
    };
    grantSpare(room, members.map((_, i) => i).filter(i => lengths[i]! > 0));
    let splits = members.map((m, i) => (shown.has(i) ? splitModuleGist(m.body, budgets[i]!) : { gist: "", rest: m.body.trim() }));
    // 句/表行边界会留下零头：把未用额度再分给仍有余文的节，最多三轮。
    for (let round = 0; round < 3; round++) {
      const used = splits.reduce((n, x, i) => n + (shown.has(i) ? x.gist.length : 0), 0);
      const spare = room - used;
      const open = members.map((_, i) => i).filter(i => shown.has(i) && splits[i]!.rest);
      if (spare < MODULE_MIN_GIST || !open.length) break;
      for (const i of open) budgets[i] = splits[i]!.gist.length;
      grantSpare(spare, open.map(i => i));
      // 增量后重切；若某节因边界无法增长，下一轮额度会继续流向别处。
      splits = members.map((m, i) => (shown.has(i) ? splitModuleGist(m.body, Math.max(budgets[i]!, splits[i]!.gist.length)) : splits[i]!));
      for (const i of open) lengths[i] = splits[i]!.rest ? lengths[i]! : splits[i]!.gist.length;
    }
    const gistParts: string[] = [header];
    const overflowParts: string[] = [];
    members.forEach((m, i) => {
      const { gist, rest } = splits[i]!;
      if (shown.has(i)) gistParts.push([multi ? `### ${heading(m.headline)}` : "", gist].filter(Boolean).join("\n\n"));
      if (rest) overflowParts.push(`### ${heading(m.headline)}\n\n${rest}`);
    });
    if (listLine) gistParts.push(listLine);
    let body = gistParts.filter(Boolean).join("\n\n").trim();
    // 防御：硬顶不超 maxChars；回收的尾段转入图外细节，不丢内容。
    while (body.length > maxChars) {
      const cut = body.lastIndexOf("\n\n");
      if (cut <= header.length) { body = body.slice(0, maxChars); break; }
      overflowParts.unshift(body.slice(cut + 2));
      body = body.slice(0, cut).trim();
    }
    return { headlines, title: imageTitle, readingTitle, body, overflow: overflowParts.join("\n\n") };
  });
}

/**
 * 命题核查（出图前门禁）：图片标题与图下内文标题必须是模型命题且不同于原小节标题，
 * 各小节内文小标题须改写（不同于原标题），且不得出现照抄字段名的占位值。
 */
export function auditKnowledgeTopicTitles(images: readonly Pick<KnowledgeTopicImage, "headlines" | "title" | "readingTitle">[], titles: KnowledgeTopicTitles) {
  let named = 0, placeholder = 0, sameAsHeadline = 0, sectionTotal = 0, sectionRenamed = 0;
  for (const image of images) {
    const entry = titles[knowledgeTopicKey(image.headlines)];
    if (entry?.image && entry?.reading && entry.image !== entry.reading) named++;
    for (const t of [image.title, image.readingTitle]) if (KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER.test(t)) placeholder++;
    if (image.headlines.includes(image.title) || image.headlines.includes(image.readingTitle)) sameAsHeadline++;
    for (const h of image.headlines) {
      sectionTotal++;
      const renamed = entry?.sections?.[h.trim()];
      if (renamed && renamed !== h.trim()) sectionRenamed++;
    }
  }
  const ok = images.length > 0 && named === images.length && placeholder === 0 && sameAsHeadline === 0 && sectionRenamed === sectionTotal;
  return { topics: images.length, named, placeholder, sameAsHeadline, sectionTotal, sectionRenamed, ok };
}

/** 命题核查的用户提示：齐全时为 null；否则说明几张图已命题、几节小标题已改写、几处占位词，以及缺项的出图后果。 */
export function knowledgeTopicTitleWarning(audit: ReturnType<typeof auditKnowledgeTopicTitles>): string | null {
  if (audit.ok) return null;
  if (!audit.topics) return "尚无主题图，无法核查命题";
  return `主题命题未齐全：${audit.named}/${audit.topics} 张图已命题、${audit.sectionRenamed}/${audit.sectionTotal} 节小标题已改写${audit.placeholder ? `、${audit.placeholder} 处占位词` : ""}${audit.sameAsHeadline ? `、${audit.sameAsHeadline} 张与原小节同名` : ""}；缺项将以机械标题（“等N节”）或原小节标题出图`;
}
