/**
 * 连载「前情提要」片头（方案 B）+ 方案 C 蒙太奇预留。
 *
 * B（本阶段）：第 3 集起，从前几集 body+endHook **抽取要点**（不重生成整集）→
 *   文案块【前情提要·片头】+ 静帧片头卡 prompt。
 * C（下一阶段）：前几集成片高光蒙太奇；见 {@link planManhuaRecapMontagePhaseC}（默认关闭）。
 */

export const MANHUA_RECAP_MIN_EPISODE = 3;

/** 方案 C 总开关：下一阶段再开，禁止本阶段误启用 */
export const MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED = false;

export type ManhuaRecapSourceEpisode = {
  index: number;
  title: string;
  body: string;
  endHook: string;
};

export function shouldAttachManhuaPreviouslyOn(episodeIndex: number): boolean {
  return Number.isFinite(episodeIndex) && Math.floor(episodeIndex) >= MANHUA_RECAP_MIN_EPISODE;
}

function oneLine(s: string, max = 48): string {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 从前几集抽出「重要剧情」要点（确定性规则，不调用模型、不重写整集）。
 * 每集提要因 prior 集合不同而不同。
 */
export function buildManhuaPreviouslyOnRecap(priorEpisodes: ManhuaRecapSourceEpisode[]): string {
  const prior = [...(priorEpisodes || [])]
    .filter((e) => e && Number.isFinite(e.index) && e.index >= 1)
    .sort((a, b) => a.index - b.index);
  if (!prior.length) return "";

  const bullets = prior.map((ep) => {
    const beat = oneLine(ep.body, 56);
    const hook = oneLine(ep.endHook, 40);
    const parts = [
      `第${ep.index}集《${oneLine(ep.title, 24) || `第${ep.index}集`}》`,
      beat ? `要点：${beat}` : "",
      hook ? `悬念：${hook}` : "",
    ].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });

  return [
    "【前情提要·片头】",
    "（给中途进入的观众：只回顾已发生的关键转折，不剧透本集新冲突）",
    ...bullets,
    "片头播完后进入本集正文；勿把提要写成完整重拍。",
  ].join("\n");
}

/** 方案 B：前情提要静帧卡（竖屏标题卡 + 要点字，供 image 节点） */
export function buildManhuaRecapCardImagePrompt(opts: {
  episodeIndex: number;
  seriesTitle?: string;
  recapText: string;
  artStyleBlock?: string;
}): string {
  const ep = Math.floor(opts.episodeIndex);
  const series = String(opts.seriesTitle || "").trim().slice(0, 40);
  const recap = String(opts.recapText || "").trim().slice(0, 900);
  return [
    "竖屏 9:16【前情提要】片头静帧卡（短剧开场用，不是正剧场次）。",
    series ? `系列：《${series}》` : "",
    `本卡用于第${ep}集开场前；画面以标题「前情提要」为主，下方 2–4 行极简剧情要点字幕（简体中文）。`,
    "氛围电影感、干净排版、可有淡角色剪影或场景色块，禁止密集分镜表、禁止真实片名/导演名。",
    "",
    "要点文案（可压缩上屏，勿新增剧情）：",
    recap,
    "",
    opts.artStyleBlock || "",
    "无水印、无 App UI、无二维码。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 方案 C 预留：高光蒙太奇计划（本阶段 enabled 恒为 false） */
export type ManhuaRecapMontagePlan = {
  phase: "C";
  /** 恒 false，直至下一阶段打开 MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED */
  enabled: boolean;
  reasonZh: string;
  episodeIndex: number;
  /** 预留：前几集成片 URL */
  sourceClipUrls: string[];
  /** 预留：每段取末尾/高光帧索引（秒） */
  highlightHints: Array<{ clipUrl: string; nearEndSec?: number }>;
  targetDurationSec: number;
};

/**
 * 方案 C · 下一阶段开发入口（勿在本阶段调用生成）。
 * 启用后应：从前几集成片抽高光/末帧 → 拼 5–12s 片头蒙太奇。
 */
export function planManhuaRecapMontagePhaseC(opts: {
  episodeIndex: number;
  priorClipUrls?: string[];
  targetDurationSec?: number;
}): ManhuaRecapMontagePlan {
  const urls = (opts.priorClipUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  return {
    phase: "C",
    enabled: MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED,
    reasonZh: MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED
      ? "方案 C 已启用（应用高光蒙太奇管线）"
      : "下一阶段：前几集成片高光蒙太奇片头（当前关闭，仅预留接口）",
    episodeIndex: Math.floor(opts.episodeIndex),
    sourceClipUrls: urls,
    highlightHints: urls.map((clipUrl) => ({ clipUrl, nearEndSec: 1.2 })),
    targetDurationSec: Math.max(5, Math.min(15, Math.floor(opts.targetDurationSec ?? 8))),
  };
}

/** 工厂/导出侧：若误开 C，应用此守卫 */
export function assertManhuaRecapMontagePhaseCNotWired(): void {
  if (MANHUA_RECAP_MONTAGE_PHASE_C_ENABLED) {
    // 下一阶段实现真实管线前，保持关闭；打开开关时也不要 silent no-op
    throw new Error("manhua recap montage phase C enabled but pipeline not implemented yet");
  }
}
