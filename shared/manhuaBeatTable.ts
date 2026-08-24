/**
 * 卡点表：**混音前的施工图**。
 *
 * 没有它，混音就是凭感觉推音量。而且铁律一（画面静音点 BGM 必须硬切停）
 * 只能靠卡点表驱动 —— 现有 `bgm_mount` 只有 entry/fade，做不到分段增益与真空静音。
 *
 * 格式四列缺一不可（`bgm-scoring` skill）：
 *   片内时间 · BGM 事件 · 画面事件 · 声音处理
 * 换算式：**片内时间 = BGM 内时间 + 入点**
 *
 * 本模块只做「量出来的事实 → 对齐 → 施工参数」的确定性拼装，零模型调用。
 */

/** 逐 0.5 秒量出来的一格电平 */
export type BgmLevelSample = {
  atSec: number;
  /** 该窗最大电平（dB，负值） */
  peakDb: number;
  /** 该窗平均电平（dB，负值） */
  meanDb: number;
};

export type BgmStructure = {
  /** 全曲最强击点 —— 对齐画面最大一刀 */
  strongestAtSec: number;
  strongestPeakDb: number;
  /** 天然空隙（mean 谷底）—— 对齐留白或转场 */
  valleyAtSec: number;
  valleyMeanDb: number;
  /** 末段衰减起点 —— 淡出从这里开始 */
  decayStartSec: number;
  totalSec: number;
};

/**
 * 从逐格电平里读出曲子结构。
 *
 * ⚠️ 输入必须是**瞬时**电平（每 0.5 秒单独量一次），
 * 不能用 astats 的累积统计 —— 那是从头到当前的平均值，
 * 拿它做卡点表会全盘错位（skill 里记了这一脚）。
 */
export function readBgmStructure(samples: readonly BgmLevelSample[]): BgmStructure | null {
  const rows = samples.filter((s) => Number.isFinite(s.atSec) && Number.isFinite(s.peakDb));
  if (rows.length < 2) return null;
  const totalSec = Math.max(...rows.map((r) => r.atSec)) + 0.5;

  let strongest = rows[0]!;
  for (const r of rows) if (r.peakDb > strongest.peakDb) strongest = r;

  // 谷底只在中段找：首尾天然低，取到那儿就没有对齐价值
  const mid = rows.filter((r) => r.atSec >= totalSec * 0.15 && r.atSec <= totalSec * 0.85);
  const pool = mid.length ? mid : rows;
  let valley = pool[0]!;
  for (const r of pool) if (r.meanDb < valley.meanDb) valley = r;

  // 衰减起点：从末尾往回找，最后一次 peak 高于 −12dB 的位置
  let decayStartSec = totalSec;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]!.peakDb > -12) {
      decayStartSec = rows[i]!.atSec;
      break;
    }
  }

  return {
    strongestAtSec: strongest.atSec,
    strongestPeakDb: strongest.peakDb,
    valleyAtSec: valley.atSec,
    valleyMeanDb: valley.meanDb,
    decayStartSec,
    totalSec,
  };
}

/** 画面事件：只收三类需要对齐的，其余不进表 */
export type FilmEventKind = "断裂点" | "静音停顿" | "转场" | "对白窗" | "终画面";

export type FilmEvent = {
  atSec: number;
  /** 停顿/对白窗有时长，击点没有 */
  durationSec?: number;
  kind: FilmEventKind;
  /** 分镜表里的原话，**不要转述** */
  descZh: string;
};

export type BeatTableRow = {
  /** 片内时间 = BGM 内时间 + 入点 */
  filmSec: number;
  bgmEventZh: string;
  filmEventZh: string;
  /** 具体到参数，不写「压低一点」 */
  soundActionZh: string;
  /** 施工用：这一段 BGM 的增益（0=硬切静音） */
  volume: number;
};

/** 基准 0.40–0.45；对白窗压到 0.18；高潮窗抬到 0.50–0.55 */
export const BGM_VOLUME = { base: 0.42, dialogue: 0.18, peak: 0.52, silent: 0 } as const;
/** 片尾淡出 1.1–1.5s，预焙在 BGM 轨上，不靠成片总线 */
export const BGM_FADE_OUT_SEC = 1.2;

/**
 * 生成卡点表。
 *
 * 对齐规则来自 skill 的对照表，是确定性的：
 *   最大一刀 → 曲子最强击点
 *   静音停顿 → **硬切静音，不是压低**
 *   转场留白 → 天然空隙
 *   对白窗   → 压到 0.18
 *   终画面   → 淡出起点
 */
export function buildBeatTable(input: {
  structure: BgmStructure;
  events: readonly FilmEvent[];
  /** BGM 在片内的入点 */
  entrySec: number;
  /** 成片总长；表以成片时间轴为准 */
  filmDurationSec: number;
}): BeatTableRow[] {
  const { structure, entrySec } = input;
  const toFilm = (bgmSec: number) => Math.round((bgmSec + entrySec) * 100) / 100;
  const rows: BeatTableRow[] = [
    {
      filmSec: toFilm(0),
      bgmEventZh: `BGM 从 0.0s 起播（入点 ${entrySec}s）`,
      filmEventZh: "开场",
      soundActionZh: `volume=${BGM_VOLUME.base} 基准铺底`,
      volume: BGM_VOLUME.base,
    },
  ];

  for (const ev of [...input.events].sort((a, b) => a.atSec - b.atSec)) {
    if (ev.atSec > input.filmDurationSec) continue;
    if (ev.kind === "静音停顿") {
      const d = Math.max(0.3, Number(ev.durationSec) || 0.5);
      rows.push({
        filmSec: ev.atSec,
        bgmEventZh: `BGM 硬切静音 ${d.toFixed(1)}s`,
        filmEventZh: ev.descZh,
        // 铁律一：挖硬切静音，不是压音量。验收该窗应是 −90dB 级
        soundActionZh: `anullsrc 真空 ${d.toFixed(1)}s（验收 −90dB 级，不是压低）`,
        volume: BGM_VOLUME.silent,
      });
      rows.push({
        filmSec: Math.round((ev.atSec + d) * 100) / 100,
        bgmEventZh: "从原位置续入，不重头",
        filmEventZh: "停顿结束",
        soundActionZh: `volume=${BGM_VOLUME.base} 续入（重头会结构错位）`,
        volume: BGM_VOLUME.base,
      });
      continue;
    }
    if (ev.kind === "断裂点") {
      rows.push({
        filmSec: ev.atSec,
        bgmEventZh: `最强击点（${structure.strongestPeakDb.toFixed(1)}dB @ BGM ${structure.strongestAtSec}s）`,
        filmEventZh: ev.descZh,
        soundActionZh: `把 BGM ${structure.strongestAtSec}s 处对齐到此，volume=${BGM_VOLUME.peak}`,
        volume: BGM_VOLUME.peak,
      });
      continue;
    }
    if (ev.kind === "转场") {
      rows.push({
        filmSec: ev.atSec,
        bgmEventZh: `天然空隙（mean ${structure.valleyMeanDb.toFixed(1)}dB @ BGM ${structure.valleyAtSec}s）`,
        filmEventZh: ev.descZh,
        soundActionZh: "空隙对齐，不加处理",
        volume: BGM_VOLUME.base,
      });
      continue;
    }
    if (ev.kind === "对白窗") {
      const d = Math.max(0.5, Number(ev.durationSec) || 2);
      rows.push({
        filmSec: ev.atSec,
        bgmEventZh: "主旋律铺底",
        filmEventZh: ev.descZh,
        soundActionZh: `volume=${BGM_VOLUME.dialogue} 压住 ${d.toFixed(1)}s，让对白吃满`,
        volume: BGM_VOLUME.dialogue,
      });
      rows.push({
        filmSec: Math.round((ev.atSec + d) * 100) / 100,
        bgmEventZh: "对白结束",
        filmEventZh: "—",
        soundActionZh: `回到 volume=${BGM_VOLUME.base}`,
        volume: BGM_VOLUME.base,
      });
      continue;
    }
    rows.push({
      filmSec: ev.atSec,
      bgmEventZh: `衰减起点（BGM ${structure.decayStartSec}s）`,
      filmEventZh: ev.descZh,
      soundActionZh: `afade=t=out:st=${(input.filmDurationSec - BGM_FADE_OUT_SEC).toFixed(1)}:d=${BGM_FADE_OUT_SEC}`,
      volume: BGM_VOLUME.base,
    });
  }

  return rows.sort((a, b) => a.filmSec - b.filmSec);
}

/** 渲染成 skill 规定的四列表格；表头带换算式 */
export function formatBeatTableMarkdown(rows: readonly BeatTableRow[], entrySec: number): string {
  const head = [
    `换算式：片内时间 = BGM 内时间 + 入点（${entrySec}s）`,
    "",
    "| 片内时间 | BGM 事件 | 画面事件 | 声音处理 |",
    "|---|---|---|---|",
  ];
  const body = rows.map(
    (r) => `| ${r.filmSec.toFixed(1)}s | ${r.bgmEventZh} | ${r.filmEventZh} | ${r.soundActionZh} |`,
  );
  return [...head, ...body].join("\n");
}

/**
 * 卡点表 → ffmpeg `volume` 表达式（分窗增益，`eval=frame`）。
 *
 * 这是卡点表真正的产物：`bgm_mount` 现在只有 entry/fade，
 * 有了这个表达式才能做到「对白窗压住、高潮窗抬起、静音窗真空」。
 */
export function beatTableToVolumeExpr(rows: readonly BeatTableRow[]): string {
  const sorted = [...rows].sort((a, b) => a.filmSec - b.filmSec);
  let expr = String(BGM_VOLUME.base);
  // 从后往前包，先匹配到的窗口生效
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    if (!next) continue;
    if (cur.volume === BGM_VOLUME.base) continue;
    expr = `if(between(t,${cur.filmSec},${next.filmSec}),${cur.volume},${expr})`;
  }
  return expr;
}
