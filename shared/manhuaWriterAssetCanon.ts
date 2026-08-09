/**
 * 编剧包人物/道具/场景表 → 系列资产真源（方案 A）。
 * 表文案为真相；库内模板仅可选参考。场景：系列池 + 每集主场景。
 */

import {
  MANHUA_EPISODE_SEGMENT_COUNT_MAX,
  MANHUA_EPISODE_SEGMENT_COUNT_MIN,
  MANHUA_EPISODE_SEGMENT_TARGET_MIN_SEC,
  MANHUA_EPISODE_SEGMENT_TARGET_SEC,
  evaluateManhuaEpisodeSegmentPlanQuality,
  manhuaEpisodeDensityFloors,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "./manhuaEpisodeSegmentPlan.js";
import { normalizeForManhuaNameMatch } from "./manhuaScriptTextNormalize.js";

export type ManhuaWriterAssetRole = "character" | "prop" | "scene";

export type ManhuaWriterAssetAnchor = {
  /** wa_char_* / wa_prop_* / wa_scene_* */
  id: string;
  role: ManhuaWriterAssetRole;
  nameZh: string;
  /** 别名：沈少主 */
  aliasZh?: string;
  /** 外形/材质视觉句（生图主锚） */
  lookZh: string;
  /** 动机/功能/氛围一句 */
  motiveZh?: string;
  /** 关系/备注 */
  noteZh?: string;
  /** 拼好的生图提示 */
  promptZh: string;
};

export type ManhuaWriterAssetCanon = {
  characters: ManhuaWriterAssetAnchor[];
  props: ManhuaWriterAssetAnchor[];
  /** 系列场景池 */
  locations: ManhuaWriterAssetAnchor[];
  /** 每集主场景 id（1-based ep → wa_scene_*） */
  episodeMainSceneId: Record<number, string>;
};

function slugToken(name: string): string {
  const raw = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff a-z0-9]+/g, "")
    .replace(/\s+/g, "");
  if (!raw) return Math.random().toString(36).slice(2, 8);
  // 中文保留前几字的 code 简写，保证稳定 id
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 33 + raw.charCodeAt(i)) >>> 0;
  return `${raw.slice(0, 12)}${h.toString(36).slice(0, 4)}`;
}

function makeAnchorId(role: ManhuaWriterAssetRole, nameZh: string): string {
  const prefix =
    role === "character" ? "wa_char_" : role === "prop" ? "wa_prop_" : "wa_scene_";
  return `${prefix}${slugToken(nameZh)}`;
}

/** 只有横线/冒号/竖线的行：分割横线或表格分隔行，都不是资产 */
function isRulerOnlyLine(rawLine: string): boolean {
  const line = String(rawLine || "").trim();
  if (!line.includes("-")) return false;
  return /^[\s:|-]+$/.test(line);
}

/**
 * Markdown 表格的分隔行：`|---|---|`、`| :--- | ---: |`。
 * 正版剧本包常用表格写人物卡，这行若当成资产会造出名叫「---」的假角色。
 *
 * 必须带竖线：孤立一行 `---` 只是普通分割横线，认成分隔行会把它上面
 * 那名角色当表头删掉。
 */
export function isMarkdownTableSeparatorLine(rawLine: string): boolean {
  const line = String(rawLine || "").trim();
  if (!line.includes("|")) return false;
  return isRulerOnlyLine(line);
}

/** 表格列名词。真实角色/道具/场景不会叫这些名字 */
const TABLE_COLUMN_LABEL_RE =
  /^(序号|编号|角色|人物|姓名|名字|名称|别名|称呼|说明|描述|简介|备注|设定|身份|外形|形象|造型|特征|动机|欲望|目标|关系|底线|禁忌|道具|物件|作用|功能|场景|地点|氛围|元素)$/;

/**
 * 是否为 Markdown 表格的表头行：整行单元格全是列名词。
 *
 * 按内容判定而不按所在位置判定——位置判定（上一行/下一行长什么样）在
 * 无表头表格、表格中段多一条分隔行等写法下会误删真实数据行，
 * 而误删一行等于脸锁静默漏一个角色。认不准就留着，最多多一个候选。
 */
function isMarkdownTableHeaderLine(rawLine: string): boolean {
  const line = String(rawLine || "").trim();
  if (!line.includes("|")) return false;
  if (/^[-*•]\s/.test(line)) return false;
  const cells = line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((s) => s.trim().replace(/\*\*/g, ""))
    .filter(Boolean);
  if (cells.length < 2) return false;
  return cells.every((c) => TABLE_COLUMN_LABEL_RE.test(c));
}

/** 去掉 Markdown 表格的表头行与分隔行，保留数据行 */
export function stripMarkdownTableHeaderLines(lines: string[]): string[] {
  return lines.filter(
    (line) => !isMarkdownTableSeparatorLine(line) && !isMarkdownTableHeaderLine(line),
  );
}

/** 拆一行「- 名/别名｜字段｜字段」 */
export function parseWriterTableLine(rawLine: string): {
  nameZh: string;
  aliasZh?: string;
  fields: string[];
} | null {
  let line = String(rawLine || "").trim();
  if (!line) return null;
  if (isRulerOnlyLine(line)) return null;
  line = line.replace(/^[-*•]\s*/, "").replace(/^\d+[\.\)、]\s*/, "");
  if (!line || /^（|^无|^见原文/.test(line)) return null;
  const parts = line.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0]!;
  const nameBits = head.split(/[\/／]/).map((s) => s.trim()).filter(Boolean);
  const nameZh = (nameBits[0] || head).slice(0, 32);
  if (!nameZh) return null;
  const aliasZh = nameBits[1]?.slice(0, 24);
  return { nameZh, aliasZh, fields: parts.slice(1).map((s) => s.slice(0, 200)) };
}

function parseTableMd(
  md: string,
  role: ManhuaWriterAssetRole,
): ManhuaWriterAssetAnchor[] {
  const lines = stripMarkdownTableHeaderLines(
    String(md || "")
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const out: ManhuaWriterAssetAnchor[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parsed = parseWriterTableLine(line);
    if (!parsed) continue;
    const id = makeAnchorId(role, parsed.nameZh);
    if (seen.has(id)) continue;
    seen.add(id);
    const f = parsed.fields;
    let lookZh = "";
    let motiveZh = "";
    let noteZh = "";
    if (role === "character") {
      // 年龄外形｜动机｜关系｜性格底线
      lookZh = f[0] || "";
      motiveZh = f[1] || "";
      noteZh = [f[2], f[3]].filter(Boolean).join("；");
    } else if (role === "prop") {
      // 功能｜外形
      motiveZh = f[0] || "";
      lookZh = f[1] || f[0] || "";
    } else {
      // 氛围｜关键元素
      motiveZh = f[0] || "";
      lookZh = f[1] || f[0] || "";
    }
    if (!lookZh && !motiveZh) continue;
    const promptZh =
      role === "character"
        ? [
            `原创角色定妆肖像（身份参考名仅供造型，勿烧字）：${parsed.nameZh}${parsed.aliasZh ? `（${parsed.aliasZh}）` : ""}`,
            lookZh ? `外形：${lookZh}` : "",
            motiveZh ? `动机气质：${motiveZh}` : "",
            noteZh ? `关系底线：${noteZh}` : "",
            "单人清晰、服化道完整、竖屏9:16。纯视觉呈现；姓名、对白与海报书法绝不能烧进画面。",
          ]
            .filter(Boolean)
            .join("。")
        : role === "prop"
          ? [
              `原创道具特写·${parsed.nameZh}`,
              lookZh ? `外形材质：${lookZh}` : "",
              motiveZh ? `剧作功能：${motiveZh}` : "",
              "主体居中、材质可读、背景干净、竖屏9:16。禁止可读文字。",
            ]
              .filter(Boolean)
              .join("。")
          : [
              `原创场景空镜·${parsed.nameZh}`,
              motiveZh ? `氛围：${motiveZh}` : "",
              lookZh ? `关键元素：${lookZh}` : "",
              "空镜为主、纵深清楚、竖屏9:16。匾额路牌保持不可辨认，禁止标题大字。",
            ]
              .filter(Boolean)
              .join("。");
    out.push({
      id,
      role,
      nameZh: parsed.nameZh,
      aliasZh: parsed.aliasZh,
      lookZh: lookZh.slice(0, 240),
      motiveZh: motiveZh.slice(0, 160) || undefined,
      noteZh: noteZh.slice(0, 200) || undefined,
      promptZh: promptZh.slice(0, 900),
    });
  }
  return out;
}

/** 从本集正文匹配系列场景池，选提及最多（并列取先出现）的作主场景 */
export function pickEpisodeMainSceneId(
  locations: ManhuaWriterAssetAnchor[],
  episodeBody: string,
): string | undefined {
  if (!locations.length) return undefined;
  const body = String(episodeBody || "");
  if (!body.trim()) return locations[0]?.id;
  let bestId = locations[0]!.id;
  let bestScore = -1;
  let bestPos = Number.POSITIVE_INFINITY;
  for (const loc of locations) {
    const names = [loc.nameZh, loc.aliasZh].filter(Boolean) as string[];
    let score = 0;
    let firstPos = Number.POSITIVE_INFINITY;
    for (const n of names) {
      let from = 0;
      while (from < body.length) {
        const i = body.indexOf(n, from);
        if (i < 0) break;
        score += 1;
        if (i < firstPos) firstPos = i;
        from = i + n.length;
      }
    }
    if (score > bestScore || (score === bestScore && score > 0 && firstPos < bestPos)) {
      bestScore = score;
      bestId = loc.id;
      bestPos = firstPos;
    }
  }
  return bestId;
}

export function buildManhuaWriterAssetCanon(input: {
  charactersMd?: string | null;
  propsMd?: string | null;
  locationsMd?: string | null;
  episodes?: Array<{ index: number; body?: string }>;
}): ManhuaWriterAssetCanon {
  const characters = parseTableMd(String(input.charactersMd || ""), "character").slice(0, 12);
  const props = parseTableMd(String(input.propsMd || ""), "prop").slice(0, 16);
  const locations = parseTableMd(String(input.locationsMd || ""), "scene").slice(0, 16);
  const episodeMainSceneId: Record<number, string> = {};
  for (const ep of input.episodes || []) {
    const idx = Math.max(1, Math.floor(ep.index));
    const main = pickEpisodeMainSceneId(locations, String(ep.body || ""));
    if (main) episodeMainSceneId[idx] = main;
  }
  return { characters, props, locations, episodeMainSceneId };
}

/** 从人物表 md 取角色名集合（含别名） */
export function collectWriterCharacterNames(
  charactersMd: string | null | undefined,
): string[] {
  const names = new Set<string>();
  const lines = stripMarkdownTableHeaderLines(
    String(charactersMd || "")
      .split(/\n/)
      .map((s) => s.trim()),
  );
  for (const line of lines) {
    const parsed = parseWriterTableLine(line);
    if (!parsed) continue;
    if (parsed.nameZh) names.add(parsed.nameZh);
    if (parsed.aliasZh) names.add(parsed.aliasZh);
  }
  return Array.from(names);
}

export type ManhuaCanonWriterDrift = {
  /** 已锁定 bible 的角色与现剧本人物表明显不一致 */
  drifted: boolean;
  /** 已锁 bible 里的角色名 */
  bibleCast: string[];
  /** 现剧本人物表角色名（含别名） */
  writerCast: string[];
  /** 交集 / 较小集合（0–1） */
  overlap: number;
  /** 只在 bible（旧设定图仍指向的角色） */
  onlyInBible: string[];
};

/**
 * 归一化后再比：已锁定的旧 bible 角色名可能来自归一化上线前的导入/手填，
 * 跟新剧本的名字繁简或空白不一致时，不归一化会被误判成「换角漂移」。
 */
function normName(s: string): string {
  return normalizeForManhuaNameMatch(String(s || "")).replace(/\s+/g, "").toLowerCase();
}

function looseNameHit(name: string, pool: string[]): boolean {
  const n = normName(name);
  if (!n) return false;
  return pool.some((p) => {
    const q = normName(p);
    return q && (q === n || q.includes(n) || n.includes(q));
  });
}

/**
 * 检测「已锁定资产 bible」与「现剧本人物表」是否发生角色漂移。
 * 用途：剧本换了主角却没重新过门禁/确认时，「按剧本重出设定图」会用旧 canon
 * 默默出旧角色——本函数供 UI 明确警示，避免烧错角色的图。
 *
 * 判定：两边都非空、且交集占较小集合不到一半 → drifted。
 */
export function detectManhuaCanonWriterDrift(
  bibleCanon: Pick<ManhuaWriterAssetCanon, "characters"> | null | undefined,
  charactersMd: string | null | undefined,
): ManhuaCanonWriterDrift {
  const bibleCast = (bibleCanon?.characters || [])
    .map((c) => String(c.nameZh || "").trim())
    .filter(Boolean);
  const writerCast = collectWriterCharacterNames(charactersMd);
  if (!bibleCast.length || !writerCast.length) {
    return { drifted: false, bibleCast, writerCast, overlap: 1, onlyInBible: [] };
  }
  const inBothFromBible = bibleCast.filter((n) => looseNameHit(n, writerCast));
  const onlyInBible = bibleCast.filter((n) => !looseNameHit(n, writerCast));
  const overlap = inBothFromBible.length / Math.min(bibleCast.length, writerCast.length);
  return {
    drifted: overlap < 0.5,
    bibleCast,
    writerCast,
    overlap: Math.round(overlap * 100) / 100,
    onlyInBible,
  };
}

export function getWriterCanonScene(
  canon: ManhuaWriterAssetCanon | null | undefined,
  sceneId?: string | null,
): ManhuaWriterAssetAnchor | null {
  const id = String(sceneId || "").trim();
  if (!id || !canon) return null;
  return canon.locations.find((l) => l.id === id) || null;
}

export function resolveEpisodeMainScene(
  canon: ManhuaWriterAssetCanon | null | undefined,
  episodeIndex: number,
): ManhuaWriterAssetAnchor | null {
  if (!canon?.locations.length) return null;
  const ep = Math.max(1, Math.floor(episodeIndex));
  const id = canon.episodeMainSceneId[ep] || canon.locations[0]?.id;
  return getWriterCanonScene(canon, id);
}

/** 系列身份硬锁（灌进设定卡/静帧，不依赖库 ID） */
export function formatWriterAssetCanonIdentityLock(
  canon: ManhuaWriterAssetCanon | null | undefined,
  opts?: { episodeIndex?: number },
): string {
  if (!canon) return "";
  const ep = opts?.episodeIndex;
  const main =
    typeof ep === "number" ? resolveEpisodeMainScene(canon, ep) : null;
  const charLines = canon.characters
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.nameZh}${c.aliasZh ? `/${c.aliasZh}` : ""}：${c.lookZh}${c.motiveZh ? `｜${c.motiveZh}` : ""}`,
    );
  const propLines = canon.props
    .slice(0, 10)
    .map((p) => `- ${p.nameZh}：${p.lookZh || p.motiveZh || ""}`);
  const locLines = canon.locations
    .slice(0, 10)
    .map((l) => `- ${l.nameZh}：${l.motiveZh || ""} ${l.lookZh || ""}`.trim());
  return [
    "【编剧表·资产真源硬锁】",
    "以下人物/道具/场景以剧本表为准，贯穿全系列；禁止换成库内无关脸与棚景。",
    charLines.length ? `人物池：\n${charLines.join("\n")}` : "",
    propLines.length ? `道具池：\n${propLines.join("\n")}` : "",
    locLines.length ? `场景池：\n${locLines.join("\n")}` : "",
    main
      ? `本集主场景：${main.nameZh}（${main.motiveZh || main.lookZh}）。同集可切池内其他场景，须有空间过渡。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatWriterAssetCanonFactoryAddon(
  canon: ManhuaWriterAssetCanon | null | undefined,
  episodeIndex: number,
): string {
  const lock = formatWriterAssetCanonIdentityLock(canon, { episodeIndex });
  if (!lock) return "";
  return `${lock}\n库内示意仅可选参考，不得覆盖上表外形与道具材质。`;
}

/** 单集密度门禁：门槛按目标秒数推算 */
export type WriterDensityGateResult = {
  ok: boolean;
  errors: string[];
  stats: {
    episodeIndex: number;
    bodyChars: number;
    dialogueLines: number;
    locationHits: number;
  }[];
};

export function countDialogueLines(text: string): number {
  const t = String(text || "");
  /** 角引号 / 直引号 / 弯引号（模型常出 “” 而非「」） */
  const cn = t.match(/「[^」]{1,80}」/g) || [];
  const en = t.match(/"[^"]{1,80}"/g) || [];
  const curly = t.match(/[\u201c“][^\u201d”]{1,80}[\u201d”]/g) || [];
  /** 可拍表「- 对白：…」行：即使无引号也计为有效对白句 */
  const planLines = (t.match(/(?:^|\n)\s*[-*·]?\s*对白\s*[:：]\s*([^\n]+)/g) || [])
    .map((line) => line.replace(/^[\s\S]*?对白\s*[:：]\s*/, "").trim())
    .filter((s) => s.length >= 6 && !/^(无|暂无|省略|同上)/.test(s));
  // 去重近似
  return new Set([...cn, ...en, ...curly, ...planLines].map((s) => s.trim())).size;
}

export function evaluateWriterEpisodeDensity(input: {
  episodes: Array<{ index: number; body?: string; endHook?: string }>;
  locationsMd?: string | null;
  /** 目标秒数；默认按成片实际长度 90s。门槛随之按段数推算 */
  targetSec?: number;
  /**
   * 真实成片布局（如 Seedance 2.5 = 4 段×30s）：只影响对白句数门槛，
   * 不传时按「总秒数 / 15」倒推段数，与旧行为一致。
   */
  segmentCount?: number;
  durationSecPerSegment?: number;
}): WriterDensityGateResult {
  const target = input.targetSec ?? MANHUA_EPISODE_SEGMENT_TARGET_SEC;
  const { minBody, minDlg, minLoc } = manhuaEpisodeDensityFloors(target, {
    segmentCount: input.segmentCount,
    durationSecPerSegment: input.durationSecPerSegment,
  });
  const canon = buildManhuaWriterAssetCanon({
    locationsMd: input.locationsMd,
    episodes: input.episodes,
  });
  const locNames = canon.locations.flatMap((l) =>
    [l.nameZh, l.aliasZh].filter(Boolean),
  ) as string[];
  const errors: string[] = [];
  const stats: WriterDensityGateResult["stats"] = [];

  for (const ep of input.episodes || []) {
    const body = String(ep.body || "");
    const dlg = countDialogueLines(body);
    let locHits = 0;
    for (const n of locNames) {
      if (n && body.includes(n)) locHits += 1;
    }
    // 无场景表时：用「。！？」句段数近似场次数不够，改查换场词
    if (!locNames.length) {
      locHits = (body.match(/。|！|？/g) || []).length >= 6 ? 2 : 1;
    }
    const bodyChars = body.replace(/\s/g, "").length;
    stats.push({
      episodeIndex: ep.index,
      bodyChars,
      dialogueLines: dlg,
      locationHits: locHits,
    });
    if (bodyChars < minBody) {
      errors.push(
        `第${ep.index}集正文过短（${bodyChars}字，至少约 ${minBody} 字），无法撑满约 ${target} 秒`,
      );
    }
    if (dlg < minDlg) {
      errors.push(
        `第${ep.index}集有效对白约 ${dlg} 句，约 ${target} 秒的集至少 ${minDlg} 句（「」内短句）`,
      );
    }
    if (locNames.length && locHits < minLoc) {
      errors.push(
        `第${ep.index}集场景表命中仅 ${locHits} 处，至少写入 ${minLoc} 个不同场景名（系列场景池）`,
      );
    }
    if (!String(ep.endHook || "").trim()) {
      errors.push(`第${ep.index}集缺少片尾钩子`);
    }
  }

  if (!(input.episodes || []).length) {
    errors.push("没有分集剧情");
  }

  return { ok: errors.length === 0, errors, stats };
}

export function evaluateWriterPackAssetAndDensity(input: {
  charactersMd?: string | null;
  propsMd?: string | null;
  locationsMd?: string | null;
  episodes: Array<{ index: number; body?: string; endHook?: string }>;
  targetSec?: number;
  /** 真实成片布局（如 Seedance 2.5 = 4 段×30s），透传给对白密度门槛 */
  segmentCount?: number;
  durationSecPerSegment?: number;
  /** 可拍表段数门禁；不传则回落 4–6（2.0 预算期） */
  segmentMin?: number;
  segmentMax?: number;
}): WriterDensityGateResult & { canon: ManhuaWriterAssetCanon } {
  const canon = buildManhuaWriterAssetCanon(input);
  const density = evaluateWriterEpisodeDensity({
    episodes: input.episodes,
    locationsMd: input.locationsMd,
    targetSec: input.targetSec,
    segmentCount: input.segmentCount,
    durationSecPerSegment: input.durationSecPerSegment,
  });
  const errors = [...density.errors];
  if (canon.characters.length < 2) {
    errors.push("人物表至少需要 2 名可锁定角色（含外形句）");
  }
  if (canon.locations.length < 1) {
    errors.push("场景表至少需要 1 个系列场景");
  }
  if (canon.props.length < 1) {
    errors.push("道具表至少需要 1 件关键道具");
  }
  // 预算期：额外要求可拍表（对白+表演/场景配色/角色/服化道/光影运镜），禁灌水。
  // 这道闸此前挂在 >=150 上，若只把 targetSec 改成 90 会被整个关掉，故改挂最短成片秒数。
  // 段数上下限跟成片引擎走：2.0→5–6、2.5→4、高清→7–8。
  if ((input.targetSec ?? MANHUA_EPISODE_SEGMENT_TARGET_SEC) >= MANHUA_EPISODE_SEGMENT_TARGET_MIN_SEC) {
    const segMin = Math.max(
      1,
      Math.floor(input.segmentMin ?? MANHUA_EPISODE_SEGMENT_COUNT_MIN),
    );
    const segMax = Math.max(
      segMin,
      Math.floor(input.segmentMax ?? MANHUA_EPISODE_SEGMENT_COUNT_MAX),
    );
    for (const ep of input.episodes || []) {
      const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(String(ep.body || ""));
      const q = evaluateManhuaEpisodeSegmentPlanQuality(plan, {
        min: segMin,
        max: segMax,
      });
      if (!q.ok) {
        errors.push(
          `第${ep.index}集可拍表未过关（合格 ${q.readyCount}，至少 ${q.requiredCount}）：${
            q.issues[0] || "缺表或缺字段"
          }`,
        );
        for (const iss of q.issues.slice(1, 3)) {
          errors.push(`第${ep.index}集：${iss}`);
        }
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    stats: density.stats,
    canon,
  };
}
