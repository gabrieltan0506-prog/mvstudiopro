/**
 * 漫剧卡点表：把瞬时电平与真实画面事件编译成可执行的 BGM 时间线。
 *
 * 本模块只做确定性计算，不调用模型或媒体服务。输出同时供卡面展示与
 * `bgm_mount` 使用，避免「表里写了静音/对白避让，ffmpeg 仍固定音量」的空壳。
 */

export type BgmLevelSample = {
  atSec: number;
  /** 当前独立量测窗的最大电平，单位 dB。 */
  peakDb: number;
  /** 当前独立量测窗的平均电平，单位 dB。 */
  meanDb: number;
};

export type BgmStructure = {
  strongestAtSec: number;
  strongestPeakDb: number;
  valleyAtSec: number;
  valleyMeanDb: number;
  decayStartSec: number;
  totalSec: number;
};

/**
 * 输入必须是逐窗瞬时电平，不能传从开头累计到当前的 astats 平均值。
 */
export function readBgmStructure(samples: readonly BgmLevelSample[]): BgmStructure | null {
  const rows = samples
    .filter((sample) =>
      Number.isFinite(sample.atSec)
      && sample.atSec >= 0
      && Number.isFinite(sample.peakDb)
      && Number.isFinite(sample.meanDb))
    .sort((a, b) => a.atSec - b.atSec);
  if (rows.length < 2) return null;

  const totalSec = rows[rows.length - 1]!.atSec + 0.5;
  let strongest = rows[0]!;
  for (const row of rows) {
    if (row.peakDb > strongest.peakDb) strongest = row;
  }

  // 首尾天然偏低，只在中段寻找有剪辑价值的留白。
  const middle = rows.filter(
    (row) => row.atSec >= totalSec * 0.15 && row.atSec <= totalSec * 0.85,
  );
  const valleyPool = middle.length ? middle : rows;
  let valley = valleyPool[0]!;
  for (const row of valleyPool) {
    if (row.meanDb < valley.meanDb) valley = row;
  }

  let decayStartSec = totalSec;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]!.peakDb > -12) {
      decayStartSec = rows[index]!.atSec;
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

export type FilmEventKind = "断裂点" | "静音停顿" | "转场" | "对白窗" | "终画面";

export type FilmEvent = {
  atSec: number;
  durationSec?: number;
  kind: FilmEventKind;
  /** 分镜/读片中的原话，不在这里改写。 */
  descZh: string;
};

export const BGM_VOLUME = {
  base: 0.42,
  dialogue: 0.18,
  peak: 0.52,
  /** 精确数字静音；不是“压低一点”。 */
  silent: 0,
} as const;

export const BGM_FADE_OUT_SEC = 1.2;

export type BeatTableAction =
  | "base"
  | "hard_silence"
  | "dialogue_duck"
  | "peak_hit"
  | "transition"
  | "fade_out";

export type BeatTableRow = {
  filmSec: number;
  /** 有结束秒位才是可执行增益窗；纯标记行不生成 volume 条件。 */
  endFilmSec?: number;
  bgmEventZh: string;
  filmEventZh: string;
  soundActionZh: string;
  volume: number;
  action: BeatTableAction;
};

export type BgmAlignment = {
  /** BGM 在片内延迟多久进入，对应 adelay。 */
  entrySec: number;
  /** 从 BGM 内部第几秒开始取，对应 atrim=start。 */
  seekSec: number;
  anchorFilmSec: number;
  anchorBgmSec: number;
};

/**
 * 把全曲最强击点搬到画面的断裂点：
 * - 音乐击点较早：整轨延后；
 * - 音乐击点较晚：从曲内向后裁；
 * 两者互斥，不使用负入点。
 */
export function buildBgmAlignment(
  structure: BgmStructure,
  events: readonly FilmEvent[],
): BgmAlignment {
  const anchor = [...events]
    .filter((event) => event.kind === "断裂点" && Number.isFinite(event.atSec))
    .sort((a, b) => a.atSec - b.atSec)[0];
  if (!anchor) {
    return {
      entrySec: 0,
      seekSec: 0,
      anchorFilmSec: 0,
      anchorBgmSec: structure.strongestAtSec,
    };
  }

  const offset = anchor.atSec - structure.strongestAtSec;
  return {
    entrySec: Math.max(0, offset),
    seekSec: Math.max(0, -offset),
    anchorFilmSec: anchor.atSec,
    anchorBgmSec: structure.strongestAtSec,
  };
}

const roundSec = (value: number): number => Math.round(value * 100) / 100;

function boundedWindow(
  startSec: number,
  durationSec: number | undefined,
  fallbackSec: number,
  filmDurationSec: number,
): { startSec: number; endSec: number } | null {
  const start = Math.max(0, roundSec(startSec));
  if (start >= filmDurationSec) return null;
  const duration = Math.max(0.05, Number(durationSec) || fallbackSec);
  const end = Math.min(filmDurationSec, roundSec(start + duration));
  return end > start ? { startSec: start, endSec: end } : null;
}

export function buildBeatTable(input: {
  structure: BgmStructure;
  events: readonly FilmEvent[];
  entrySec: number;
  /** 与 entrySec 一起来自 buildBgmAlignment；旧调用缺省为从曲首开始。 */
  bgmSeekSec?: number;
  filmDurationSec: number;
}): BeatTableRow[] {
  const filmDurationSec = Math.max(0, Number(input.filmDurationSec) || 0);
  const entrySec = Math.min(filmDurationSec, Math.max(0, Number(input.entrySec) || 0));
  const seekSec = Math.max(0, Number(input.bgmSeekSec) || 0);
  const rows: BeatTableRow[] = [
    {
      filmSec: roundSec(entrySec),
      bgmEventZh: `BGM 从曲内 ${seekSec.toFixed(1)}s 起播（片内入点 ${entrySec.toFixed(1)}s）`,
      filmEventZh: "开场",
      soundActionZh: `volume=${BGM_VOLUME.base} 基准铺底`,
      volume: BGM_VOLUME.base,
      action: "base",
    },
  ];

  const events = [...input.events]
    .filter((event) => Number.isFinite(event.atSec) && event.atSec >= 0)
    .sort((a, b) => a.atSec - b.atSec);

  for (const event of events) {
    if (event.atSec > filmDurationSec) continue;

    if (event.kind === "静音停顿") {
      const window = boundedWindow(event.atSec, event.durationSec, 0.5, filmDurationSec);
      if (!window) continue;
      rows.push({
        filmSec: window.startSec,
        endFilmSec: window.endSec,
        bgmEventZh: `BGM 硬切静音 ${(window.endSec - window.startSec).toFixed(1)}s`,
        filmEventZh: event.descZh,
        soundActionZh: "volume=0 精确数字静音（验收应接近 −90dB，不是压低）",
        volume: BGM_VOLUME.silent,
        action: "hard_silence",
      });
      rows.push({
        filmSec: window.endSec,
        bgmEventZh: "从原位置续入，不重头",
        filmEventZh: "停顿结束",
        soundActionZh: `回到 volume=${BGM_VOLUME.base}`,
        volume: BGM_VOLUME.base,
        action: "base",
      });
      continue;
    }

    if (event.kind === "对白窗") {
      const window = boundedWindow(event.atSec, event.durationSec, 2, filmDurationSec);
      if (!window) continue;
      rows.push({
        filmSec: window.startSec,
        endFilmSec: window.endSec,
        bgmEventZh: "主旋律退后",
        filmEventZh: event.descZh,
        soundActionZh: `volume=${BGM_VOLUME.dialogue} 对白避让 ${(window.endSec - window.startSec).toFixed(1)}s`,
        volume: BGM_VOLUME.dialogue,
        action: "dialogue_duck",
      });
      rows.push({
        filmSec: window.endSec,
        bgmEventZh: "对白结束",
        filmEventZh: "—",
        soundActionZh: `回到 volume=${BGM_VOLUME.base}`,
        volume: BGM_VOLUME.base,
        action: "base",
      });
      continue;
    }

    if (event.kind === "断裂点") {
      const window = boundedWindow(event.atSec, event.durationSec, 0.35, filmDurationSec);
      if (!window) continue;
      rows.push({
        filmSec: window.startSec,
        endFilmSec: window.endSec,
        bgmEventZh: `最强击点（${input.structure.strongestPeakDb.toFixed(1)}dB @ BGM ${input.structure.strongestAtSec}s）`,
        filmEventZh: event.descZh,
        soundActionZh: `把 BGM ${input.structure.strongestAtSec}s 对齐到此，volume=${BGM_VOLUME.peak}`,
        volume: BGM_VOLUME.peak,
        action: "peak_hit",
      });
      continue;
    }

    if (event.kind === "转场") {
      rows.push({
        filmSec: roundSec(event.atSec),
        bgmEventZh: `天然空隙（mean ${input.structure.valleyMeanDb.toFixed(1)}dB @ BGM ${input.structure.valleyAtSec}s）`,
        filmEventZh: event.descZh,
        soundActionZh: "空隙对齐，不额外抬升",
        volume: BGM_VOLUME.base,
        action: "transition",
      });
      continue;
    }

    const fadeDuration = Math.min(BGM_FADE_OUT_SEC, filmDurationSec);
    rows.push({
      filmSec: roundSec(Math.max(0, filmDurationSec - fadeDuration)),
      endFilmSec: roundSec(filmDurationSec),
      bgmEventZh: `衰减起点（BGM ${input.structure.decayStartSec}s）`,
      filmEventZh: event.descZh,
      soundActionZh: `afade=t=out:st=${Math.max(0, filmDurationSec - fadeDuration).toFixed(1)}:d=${fadeDuration.toFixed(1)}`,
      volume: BGM_VOLUME.base,
      action: "fade_out",
    });
  }

  return rows.sort((a, b) => a.filmSec - b.filmSec);
}

/**
 * 表头换算同时包含曲内 seek：片内 = (BGM 内时间 - seek) + 入点。
 */
export function formatBeatTableMarkdown(
  rows: readonly BeatTableRow[],
  entrySec: number,
  bgmSeekSec = 0,
): string {
  const head = [
    `换算式：片内时间 = (BGM 内时间 - 曲内起播 ${bgmSeekSec}s) + 入点 ${entrySec}s`,
    "",
    "| 片内时间 | BGM 事件 | 画面事件 | 声音处理 |",
    "|---|---|---|---|",
  ];
  const body = rows.map((row) =>
    `| ${row.filmSec.toFixed(1)}s | ${row.bgmEventZh} | ${row.filmEventZh} | ${row.soundActionZh} |`);
  return [...head, ...body].join("\n");
}

const ACTION_PRIORITY: Record<BeatTableAction, number> = {
  base: 0,
  transition: 0,
  fade_out: 0,
  peak_hit: 10,
  dialogue_duck: 20,
  hard_silence: 30,
};

const ffNumber = (value: number): string => String(roundSec(value));

/**
 * 卡点表 → ffmpeg `volume` 的逐帧表达式。
 *
 * 重叠优先级：精确静音 > 对白避让 > 高潮击点。静音必须最外层，保证任何
 * 同秒高潮或对白都不能把“全频停一拍”重新抬起来。
 */
export function beatTableToVolumeExpr(rows: readonly BeatTableRow[]): string {
  const windows = rows
    .filter((row) =>
      row.endFilmSec !== undefined
      && row.endFilmSec > row.filmSec
      && ACTION_PRIORITY[row.action] > 0)
    .sort((a, b) =>
      ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action]
      || a.filmSec - b.filmSec);

  let expression = String(BGM_VOLUME.base);
  for (const row of windows) {
    expression =
      `if(between(t,${ffNumber(row.filmSec)},${ffNumber(row.endFilmSec!)}),`
      + `${row.volume},${expression})`;
  }
  return expression;
}
