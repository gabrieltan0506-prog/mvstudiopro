/**
 * 剧情与情绪结构（编剧确认时冻结，分镜/声音/终审读同一份）。
 *
 * 为什么要这层：在此之前，人物目标、因果节拍、情绪变化、伏笔只活在 charactersMd 与剧本正文的
 * 自由文本里，下游没有任何字段可读 —— 分镜卡说不出「这一镜要达成什么情绪目的」，配乐说不出
 * 「哪里该留白」。本模块把这些做成结构化真源，跟 directionCanon / assetCanon 同一条路：
 * 挂在 ManhuaProjectBible 上，随 writerSession 存本地与云端草稿，刷新即恢复。
 *
 * 边界（写死，别放宽）：
 * - 这里只存**设计判断**，不存测量值。强度是 0–10 的人工标尺，字段名 intensity 后面永远跟
 *   designNote，禁止把它当成从成片算出来的指标。
 * - 节拍绑定的是「段」（segmentIndex）与可选「镜」（shotId），沿用既有身份，不另造编号体系。
 * - 伏笔只记「埋设在哪、谁知道、何时可揭」，**不把未来状态写进当前资产** —— 那是 0917
 *   「造型漂移」那类事故的源头。
 */

export const MANHUA_STORY_EMOTION_FORMAT = "mv-manhua-story-emotion-v1" as const;

/** 节拍：开始状态 → 触发 → 选择 → 结束状态。四段齐了才算一条可用节拍。 */
export type ManhuaStoryBeat = {
  id: string;
  episode: number;
  /** 1-based 段号，沿用工厂既有段身份 */
  segmentIndex: number;
  /** 可选钉到某一镜（ap_shot_e{ep}_s{seg}_t{idx}），没有就只绑段 */
  shotId?: string;
  /** 谁的节拍：人物锚点名（与剧本人物表同名，不另造 id） */
  characterZh: string;
  /** 他想得到什么 */
  wantZh: string;
  /** 阻力来自谁/什么 */
  obstacleZh: string;
  /** 开始状态 */
  fromStateZh: string;
  /** 触发事件 */
  triggerZh: string;
  /** 人物的选择（不是"发生了什么"，是"他决定做什么"） */
  choiceZh: string;
  /** 结束状态；与 fromState 相同＝这段没有信息变化，UI 要提示 */
  toStateZh: string;
  /** 原文位置或 "原创"：每条改写都要能追回剧本 */
  sourceZh: string;
};

/** 情绪曲线上的一点。intensity 是设计标尺不是测量值。 */
export type ManhuaEmotionPoint = {
  episode: number;
  segmentIndex: number;
  /** 0–10 设计判断 */
  intensity: number;
  /** 上升/转折/回落/留白 —— 留白是正当设计，不是缺口 */
  kind: "rise" | "turn" | "fall" | "breath";
  /** 为什么是这个强度：必须能由剧情变化解释 */
  reasonZh: string;
};

/** 跨集伏笔：埋设与兑现分开记，避免把未来状态提前写进当前资产。 */
export type ManhuaForeshadow = {
  id: string;
  labelZh: string;
  /** 埋在哪一集哪一段 */
  plantedEpisode: number;
  plantedSegmentIndex: number;
  /** 此刻谁知道（人物锚点名）；观众是否知道单独记 */
  knownByZh: string[];
  audienceKnows: boolean;
  /** 最早可揭示的集号；未定填 0 */
  revealEpisode: number;
  status: "planted" | "reinforced" | "paid_off" | "dropped";
  /** 兑现在哪（已兑现时必填） */
  paidOffAtZh?: string;
};

export type ManhuaStoryEmotion = {
  format: typeof MANHUA_STORY_EMOTION_FORMAT;
  /** 生成时依据的剧本版本标识（换剧本后旧分析必须失效，不静默沿用） */
  scriptVersionKey: string;
  beats: ManhuaStoryBeat[];
  curve: ManhuaEmotionPoint[];
  foreshadows: ManhuaForeshadow[];
  /** 未读范围/待核项，如实写出来，不假装全覆盖 */
  unreviewedZh: string[];
};

const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);
const posInt = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function normalizeBeat(raw: unknown): ManhuaStoryBeat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const episode = posInt(r.episode);
  const segmentIndex = posInt(r.segmentIndex);
  const characterZh = text(r.characterZh, 80);
  if (!episode || !segmentIndex) return null;
  const id = text(r.id, 120) || `beat_e${episode}_s${segmentIndex}_${characterZh}`;
  return {
    id,
    episode,
    segmentIndex,
    ...(text(r.shotId, 120) ? { shotId: text(r.shotId, 120) } : {}),
    characterZh,
    wantZh: text(r.wantZh, 400),
    obstacleZh: text(r.obstacleZh, 400),
    fromStateZh: text(r.fromStateZh, 400),
    triggerZh: text(r.triggerZh, 400),
    choiceZh: text(r.choiceZh, 400),
    toStateZh: text(r.toStateZh, 400),
    sourceZh: text(r.sourceZh, 200),
  };
}

const CURVE_KINDS = new Set(["rise", "turn", "fall", "breath"]);

function normalizeCurvePoint(raw: unknown): ManhuaEmotionPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const episode = posInt(r.episode);
  const segmentIndex = posInt(r.segmentIndex);
  if (!episode || !segmentIndex) return null;
  const kindRaw = text(r.kind, 10);
  const n = Number(r.intensity);
  return {
    episode,
    segmentIndex,
    intensity: Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n * 10) / 10)) : 0,
    kind: (CURVE_KINDS.has(kindRaw) ? kindRaw : "rise") as ManhuaEmotionPoint["kind"],
    reasonZh: text(r.reasonZh, 400),
  };
}

const FORESHADOW_STATUS = new Set(["planted", "reinforced", "paid_off", "dropped"]);

function normalizeForeshadow(raw: unknown): ManhuaForeshadow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const labelZh = text(r.labelZh, 120);
  const plantedEpisode = posInt(r.plantedEpisode);
  if (!labelZh || !plantedEpisode) return null;
  const statusRaw = text(r.status, 20);
  const knownBy = Array.isArray(r.knownByZh)
    ? r.knownByZh.map((s) => text(s, 80)).filter(Boolean).slice(0, 20)
    : [];
  return {
    id: text(r.id, 120) || `fs_e${plantedEpisode}_${labelZh}`,
    labelZh,
    plantedEpisode,
    plantedSegmentIndex: posInt(r.plantedSegmentIndex),
    knownByZh: knownBy,
    audienceKnows: Boolean(r.audienceKnows),
    revealEpisode: Math.max(0, Math.floor(Number(r.revealEpisode)) || 0),
    status: (FORESHADOW_STATUS.has(statusRaw) ? statusRaw : "planted") as ManhuaForeshadow["status"],
    ...(text(r.paidOffAtZh, 200) ? { paidOffAtZh: text(r.paidOffAtZh, 200) } : {}),
  };
}

/**
 * 存稿/云草稿回灌的入口。整份解析不出来就返回 undefined —— 宁可没有，也不要半份脏数据
 * 让下游以为「分析过了」。
 */
export function normalizeManhuaStoryEmotion(raw: unknown): ManhuaStoryEmotion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.format !== MANHUA_STORY_EMOTION_FORMAT) return undefined;
  // 版本键包含全部集数，不能截断，否则刷新后会与当前剧本永久不匹配。
  const scriptVersionKey = String(r.scriptVersionKey ?? "").trim();
  if (!scriptVersionKey) return undefined;
  const beats = Array.isArray(r.beats)
    ? r.beats.map(normalizeBeat).filter((b): b is ManhuaStoryBeat => Boolean(b))
    : [];
  const curve = Array.isArray(r.curve)
    ? r.curve.map(normalizeCurvePoint).filter((p): p is ManhuaEmotionPoint => Boolean(p))
    : [];
  const foreshadows = Array.isArray(r.foreshadows)
    ? r.foreshadows.map(normalizeForeshadow).filter((f): f is ManhuaForeshadow => Boolean(f))
    : [];
  if (!beats.length && !curve.length && !foreshadows.length) return undefined;
  const unreviewedZh = Array.isArray(r.unreviewedZh)
    ? r.unreviewedZh.map((s) => text(s, 200)).filter(Boolean).slice(0, 50)
    : [];
  return { format: MANHUA_STORY_EMOTION_FORMAT, scriptVersionKey, beats, curve, foreshadows, unreviewedZh };
}

/**
 * 换了剧本，旧分析必须失效。
 * 判据是剧本版本标识不等，**不是**时间戳新旧 —— 云草稿会把一周前的分析回灌，
 * 时间戳判不出来（0917 bible 漂移就是这么发生的）。
 */
export function manhuaStoryEmotionIsStale(
  analysis: ManhuaStoryEmotion | null | undefined,
  currentScriptVersionKey: string,
): boolean {
  if (!analysis) return false;
  return analysis.scriptVersionKey !== String(currentScriptVersionKey || "");
}

/** 下游按段取：分镜卡要显示「这一段要达成什么」。 */
export function manhuaStoryBeatsOfSegment(
  analysis: ManhuaStoryEmotion | null | undefined,
  episode: number,
  segmentIndex: number,
): ManhuaStoryBeat[] {
  if (!analysis) return [];
  return analysis.beats.filter((b) => b.episode === episode && b.segmentIndex === segmentIndex);
}

/** 下游按段取情绪目的；同段多点时取强度最高的那一点当主目的。 */
export function manhuaEmotionOfSegment(
  analysis: ManhuaStoryEmotion | null | undefined,
  episode: number,
  segmentIndex: number,
): ManhuaEmotionPoint | null {
  if (!analysis) return null;
  const points = analysis.curve.filter((p) => p.episode === episode && p.segmentIndex === segmentIndex);
  if (!points.length) return null;
  return points.reduce((best, p) => (p.intensity > best.intensity ? p : best), points[0]);
}

/**
 * 配乐要的东西：留白段不给强音乐。
 * 只报 kind==="breath" 的段，不替配乐决定用什么曲子。
 */
export function manhuaBreathSegments(
  analysis: ManhuaStoryEmotion | null | undefined,
  episode: number,
): number[] {
  if (!analysis) return [];
  return Array.from(
    new Set(
      analysis.curve
        .filter((p) => p.episode === episode && p.kind === "breath")
        .map((p) => p.segmentIndex),
    ),
  ).sort((a, b) => a - b);
}

export type ManhuaStoryEmotionIssue = {
  level: "block" | "warn";
  messageZh: string;
  episode?: number;
  segmentIndex?: number;
};

/**
 * 体检：只报能由数据判定的问题，不做文学评价。
 * block = 这条节拍不完整，下游读了也没用；warn = 可能是有意设计（留白、悬而未决），给人看不拦路。
 */
export function checkManhuaStoryEmotion(
  analysis: ManhuaStoryEmotion | null | undefined,
): ManhuaStoryEmotionIssue[] {
  if (!analysis) return [];
  const issues: ManhuaStoryEmotionIssue[] = [];
  for (const b of analysis.beats) {
    const missing: string[] = [];
    if (!b.characterZh) missing.push("人物");
    if (!b.fromStateZh) missing.push("开始状态");
    if (!b.triggerZh) missing.push("触发");
    if (!b.choiceZh) missing.push("选择");
    if (!b.toStateZh) missing.push("结束状态");
    if (missing.length)
      issues.push({
        level: "block",
        messageZh: `${b.characterZh} 的节拍缺${missing.join("、")}，下游读不到完整因果`,
        episode: b.episode,
        segmentIndex: b.segmentIndex,
      });
    else if (b.fromStateZh === b.toStateZh)
      issues.push({
        level: "warn",
        messageZh: `${b.characterZh} 这一段开始与结束状态相同：没有信息变化，确认是留白还是漏写`,
        episode: b.episode,
        segmentIndex: b.segmentIndex,
      });
    if (!b.sourceZh)
      issues.push({
        level: "warn",
        messageZh: `${b.characterZh} 的节拍没写原文位置，无法追回剧本`,
        episode: b.episode,
        segmentIndex: b.segmentIndex,
      });
  }
  for (const f of analysis.foreshadows) {
    if (f.status === "paid_off" && !f.paidOffAtZh)
      issues.push({ level: "block", messageZh: `伏笔「${f.labelZh}」标为已兑现但没写兑现位置` });
    if (f.revealEpisode && f.revealEpisode < f.plantedEpisode)
      issues.push({ level: "block", messageZh: `伏笔「${f.labelZh}」的揭示集早于埋设集` });
  }
  return issues;
}

/** UI 一行摘要：不打印内部 id。 */
export function summarizeManhuaStoryEmotion(analysis: ManhuaStoryEmotion | null | undefined): string {
  if (!analysis) return "未做剧情与情绪分析";
  const blocks = checkManhuaStoryEmotion(analysis).filter((i) => i.level === "block").length;
  const open = analysis.foreshadows.filter((f) => f.status === "planted" || f.status === "reinforced").length;
  return [
    `${analysis.beats.length} 条节拍`,
    `${analysis.curve.length} 个情绪点`,
    open ? `${open} 条伏笔未兑现` : "伏笔已结清",
    blocks ? `${blocks} 处待补` : "无阻断",
  ].join(" · ");
}

/* ────────────────────────────────────────────────────────────────────────────
 * 下游投影：把剧情情绪投到「配乐」与「分镜段提示词」两个消费端。
 *
 * 收口成一个模块的理由：同一份判断只能有一处实现。留白到底算不算「该给静默」，
 * 配乐一套、分镜一套，迟早对不上 —— 0917 走位判据写两遍就是这么裂的。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 情绪点类型 → 配乐段情绪。留白不映射成任何 mood，它走 [Break]，不是一种"曲风"。 */
const EMOTION_KIND_TO_BGM_MOOD: Record<ManhuaEmotionPoint["kind"], "蓄力" | "冲突" | "反转" | "收束" | null> = {
  rise: "蓄力",
  turn: "反转",
  fall: "收束",
  breath: null,
};

export type ManhuaStoryEmotionBgmProjection = {
  /** 按段序去重后的情绪走向；空数组＝没有可用曲线，调用方保持原有推导 */
  moods: Array<"蓄力" | "冲突" | "反转" | "收束">;
  /** 有留白段就该在爆点前插 [Break]；这是画面真的要静，不是模型自由发挥 */
  hasSilenceBreak: boolean;
  /** 留白落在哪几段（1-based），给人看的 */
  breathSegmentIndexes: number[];
};

/**
 * 投给配乐：只回答「情绪怎么走、哪里要静」，不替它选乐器、不定 bpm。
 * 强度进不了这里 —— 它是设计标尺，拿去调音量就是把判断当测量。
 */
export function projectManhuaStoryEmotionForBgm(
  analysis: ManhuaStoryEmotion | null | undefined,
  episode: number,
): ManhuaStoryEmotionBgmProjection {
  const empty: ManhuaStoryEmotionBgmProjection = { moods: [], hasSilenceBreak: false, breathSegmentIndexes: [] };
  if (!analysis) return empty;
  const points = analysis.curve
    .filter((p) => p.episode === episode)
    .slice()
    .sort((a, b) => a.segmentIndex - b.segmentIndex);
  if (!points.length) return empty;
  const moods: ManhuaStoryEmotionBgmProjection["moods"] = [];
  for (const p of points) {
    const mood = EMOTION_KIND_TO_BGM_MOOD[p.kind];
    if (!mood) continue;
    if (moods.at(-1) === mood) continue; // 相邻同情绪合并，别让弧线原地踏步
    moods.push(mood);
  }
  const breathSegmentIndexes = manhuaBreathSegments(analysis, episode);
  return { moods, hasSilenceBreak: breathSegmentIndexes.length > 0, breathSegmentIndexes };
}

/**
 * 投给分镜段提示词：一行中文，说清这一段要达成什么。
 * 空字符串＝没分析过，调用方**原样不注入**，不给默认情绪（跟 directionCanon 缺省时同样的规矩）。
 */
export function projectManhuaStoryEmotionForSegment(
  analysis: ManhuaStoryEmotion | null | undefined,
  episode: number,
  segmentIndex: number,
): string {
  if (!analysis) return "";
  const point = manhuaEmotionOfSegment(analysis, episode, segmentIndex);
  const beats = manhuaStoryBeatsOfSegment(analysis, episode, segmentIndex).filter(
    (beat) => beat.characterZh && beat.fromStateZh && beat.triggerZh && beat.choiceZh && beat.toStateZh,
  );
  const parts: string[] = [];
  if (point) {
    if (point.kind === "breath") parts.push("本段是呼吸区：收情绪，不加戏");
    else parts.push(`本段情绪目的：${point.reasonZh || KIND_LABEL_ZH[point.kind]}`);
  }
  // 只取第一条节拍：段里多条节拍时提示词塞满反而稀释重点，其余在面板里看
  const beat = beats[0];
  if (beat) {
    const line = [
      beat.characterZh,
      beat.wantZh ? `要${beat.wantZh}` : "",
      beat.obstacleZh ? `受阻于${beat.obstacleZh}` : "",
      beat.choiceZh ? `选择${beat.choiceZh}` : "",
    ]
      .filter(Boolean)
      .join("，");
    if (line) parts.push(`人物动作动机：${line}`);
  }
  return parts.join("；");
}

const KIND_LABEL_ZH: Record<ManhuaEmotionPoint["kind"], string> = {
  rise: "情绪上升",
  turn: "转折",
  fall: "回落",
  breath: "留白",
};
