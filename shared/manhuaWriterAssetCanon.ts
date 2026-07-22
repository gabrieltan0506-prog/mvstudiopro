/**
 * 编剧包人物/道具/场景表 → 系列资产真源（方案 A）。
 * 表文案为真相；库内模板仅可选参考。场景：系列池 + 每集主场景。
 */

import {
  evaluateManhuaEpisodeSegmentPlanQuality,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "./manhuaEpisodeSegmentPlan.js";

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

/** 拆一行「- 名/别名｜字段｜字段」 */
export function parseWriterTableLine(rawLine: string): {
  nameZh: string;
  aliasZh?: string;
  fields: string[];
} | null {
  let line = String(rawLine || "").trim();
  if (!line) return null;
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
  const lines = String(md || "")
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
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

/** 三分钟集密度门禁 */
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

const MIN_BODY_CHARS = 280;
/** 三分钟档：约 10 段 × 至少 3 句「」 */
const MIN_DIALOGUE_LINES = 30;
const MIN_LOCATION_HITS = 2;

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
  /** 目标秒数；≥150 按三分钟档 */
  targetSec?: number;
}): WriterDensityGateResult {
  const target = input.targetSec ?? 180;
  const strict = target >= 150;
  const minBody = strict ? MIN_BODY_CHARS : 160;
  const minDlg = strict ? MIN_DIALOGUE_LINES : 4;
  const minLoc = strict ? MIN_LOCATION_HITS : 1;
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
        `第${ep.index}集有效对白约 ${dlg} 句，三分钟集至少 ${minDlg} 句（「」内短句）`,
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
}): WriterDensityGateResult & { canon: ManhuaWriterAssetCanon } {
  const canon = buildManhuaWriterAssetCanon(input);
  const density = evaluateWriterEpisodeDensity(input);
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
  // 三分钟档：额外要求 10–12 段可拍表（对白+表演/场景配色/角色/服化道/光影运镜），禁灌水
  if ((input.targetSec ?? 180) >= 150) {
    for (const ep of input.episodes || []) {
      const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(String(ep.body || ""));
      const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
      if (!q.ok) {
        errors.push(
          `第${ep.index}集十至十二段可拍表未过关（合格 ${q.readyCount}，至少 ${q.requiredCount}）：${
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
