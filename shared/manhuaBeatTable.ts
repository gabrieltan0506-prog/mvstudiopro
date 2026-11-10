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


// ── 拍点网格（1109 MV 秒锁复用）──────────────────────────────────────
// 上面的电平卡点表是 0.5 秒电平窗，分辨率不到 1 拍（129 BPM 一拍≈0.465 秒），不能直接定剪点。
// 这里补「给定 BPM 的拍点网格」：起音包络求相位与逐拍重音强度；BPM 以分镜/用户给定为准，自相关估值只作核对。


export type MusicBeatGrid = {
  bpm: number;
  /** 第一拍（相对输入 PCM 起点的秒数，0 ≤ phase < 1 拍）。 */
  phaseSec: number;
  /** 逐拍：歌曲时间（相对输入起点 + offsetSec）与 0–1 重音强度。 */
  beats: Array<{ sec: number; strength: number }>;
  /** 由起音包络自相关估得的 BPM（核对用，不参与网格）。 */
  estimatedBpm: number;
};

const HOP_SEC = 0.01;

/** 半波整流的能量差分包络（10ms 帧）。 */
export function onsetEnvelope(samples: ArrayLike<number>, sampleRate: number): number[] {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const frames = Math.floor(samples.length / hop);
  const energy: number[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) sum += samples[i] * samples[i];
    energy[f] = Math.log1p(1000 * Math.sqrt(sum / hop));
  }
  const env: number[] = new Array(frames).fill(0);
  for (let f = 1; f < frames; f++) env[f] = Math.max(0, energy[f] - energy[f - 1]);
  return env;
}

function envAt(env: number[], sec: number) {
  const f = Math.round(sec / HOP_SEC);
  let best = 0;
  for (let d = -3; d <= 3; d++) best = Math.max(best, env[f + d] ?? 0); // ±30ms 容差
  return best;
}

export function buildMusicBeatGrid(
  samples: ArrayLike<number>,
  sampleRate: number,
  bpm: number,
  offsetSec = 0,
): MusicBeatGrid {
  if (!(bpm >= 40 && bpm <= 240)) throw new Error("BPM 超出 40–240");
  const env = onsetEnvelope(samples, sampleRate);
  const durationSec = env.length * HOP_SEC;
  const beatSec = 60 / bpm;
  let bestPhase = 0;
  let bestScore = -1;
  for (let p = 0; p < beatSec; p += HOP_SEC) {
    let score = 0;
    for (let t = p; t < durationSec; t += beatSec) score += envAt(env, t);
    if (score > bestScore) { bestScore = score; bestPhase = p; }
  }
  const raw: Array<{ sec: number; v: number }> = [];
  for (let t = bestPhase; t < durationSec; t += beatSec) raw.push({ sec: t, v: envAt(env, t) });
  const max = Math.max(1e-9, ...raw.map(r => r.v));
  // 自相关核对 BPM（60–200）
  let estimatedBpm = bpm;
  let bestAc = -1;
  for (let lag = Math.round(0.3 / HOP_SEC); lag <= Math.round(1 / HOP_SEC); lag++) {
    let ac = 0;
    for (let i = lag; i < env.length; i++) ac += env[i] * env[i - lag];
    if (ac > bestAc) { bestAc = ac; estimatedBpm = 60 / (lag * HOP_SEC); }
  }
  return {
    bpm,
    phaseSec: Number(bestPhase.toFixed(3)),
    beats: raw.map(r => ({ sec: Number((r.sec + offsetSec).toFixed(3)), strength: Number((r.v / max).toFixed(3)) })),
    estimatedBpm: Number(estimatedBpm.toFixed(1)),
  };
}

/** 从创作说明里读 BPM（如「129 BPM」）。 */
export function parseBpmFromText(text: string | undefined): number | undefined {
  const m = /(\d{2,3}(?:\.\d+)?)\s*BPM/i.exec(String(text || ""));
  const n = m ? Number(m[1]) : NaN;
  return n >= 40 && n <= 240 ? n : undefined;
}

/** 把计划剪点吸附到最近拍点（首尾固定为高光区间端点，不吸附）；保持严格递增且每段 ≥ minGapSec。 */
export function snapCutsToBeats(
  cuts: readonly number[],
  beats: ReadonlyArray<{ sec: number }>,
  minGapSec = 1,
): number[] {
  if (cuts.length < 2) return [...cuts];
  const out = [cuts[0]!];
  for (let i = 1; i < cuts.length - 1; i += 1) {
    const ideal = cuts[i]!;
    const sorted = [...beats].sort((a, b) => Math.abs(a.sec - ideal) - Math.abs(b.sec - ideal));
    const pick = sorted.find((b) => b.sec - out[out.length - 1]! >= minGapSec && cuts[cuts.length - 1]! - b.sec >= minGapSec);
    out.push(pick ? Math.round(pick.sec * 1000) / 1000 : ideal);
  }
  out.push(cuts[cuts.length - 1]!);
  return out;
}


const LYRICAL_RE = /抒情|慢歌|情歌|舒缓|安静|unhurried|ballad|slow|lyrical|mellow|gentle|chill|lo-?fi|R&B/i;
const UPBEAT_RE = /舞曲|快歌|劲爆|动感|燃|dance|upbeat|uptempo|EDM|house|techno|drum ?& ?bass|punk|fast/i;

/**
 * 1109 BPM 消歧（半速/倍速）：起音自相关常把 65 BPM 判成 129/130。
 * 优先级：歌曲生成提示词里写明的 BPM（如 Suno 风格提示词）＞ 检测候选（×0.5/×1/×2）按语义选（抒情偏 ≤90，劲爆偏 ≥110）
 * ＞ 创作说明里的 BPM（与检测/语义冲突时按半/倍速修正并记原值）。
 */
export function resolveSongBpm(input: { estimatedBpm: number; generationPrompt?: string; creativePrompt?: string }): {
  bpm: number; source: "generation_prompt" | "creative_prompt" | "estimated"; lyrical: boolean; correctedFrom?: number; reasonZh: string;
} {
  const text = `${input.generationPrompt || ""}\n${input.creativePrompt || ""}`;
  const lyrical = LYRICAL_RE.test(text) && !UPBEAT_RE.test(text);
  const upbeat = UPBEAT_RE.test(text) && !LYRICAL_RE.test(text);
  const fromGen = parseBpmFromText(input.generationPrompt);
  const fromCreative = parseBpmFromText(input.creativePrompt);
  const cands = [input.estimatedBpm / 2, input.estimatedBpm, input.estimatedBpm * 2].filter(b => b >= 50 && b <= 200);
  const near = (a: number, b: number) => Math.abs(a - b) / b < 0.06;
  if (fromGen) {
    const corrected = fromCreative && !near(fromCreative, fromGen) ? fromCreative : undefined;
    return { bpm: fromGen, source: "generation_prompt", lyrical, ...(corrected ? { correctedFrom: corrected } : {}), reasonZh: `以歌曲生成提示词 ${fromGen} BPM 为准${corrected ? `（创作说明写 ${corrected} BPM，为${near(corrected, fromGen * 2) ? "倍速" : near(corrected * 2, fromGen) ? "半速" : "不一致"}误判，已覆盖）` : ""}` };
  }
  const pickSemantic = () => (lyrical ? cands.filter(b => b <= 90).sort((a, b) => b - a)[0] : upbeat ? cands.filter(b => b >= 110).sort((a, b) => a - b)[0] : undefined);
  if (fromCreative) {
    // 创作说明的 BPM 与检测同族（×0.5/×1/×2）但与语义矛盾时，按语义取半/倍速
    const sem = pickSemantic();
    if (sem && !near(fromCreative, sem) && (near(fromCreative, sem * 2) || near(fromCreative * 2, sem)))
      return { bpm: Math.round(sem), source: "estimated", lyrical, correctedFrom: fromCreative, reasonZh: `创作说明写 ${fromCreative} BPM，与检测和曲风语义（${lyrical ? "抒情" : "劲爆"}）不符，按${fromCreative > sem ? "半速" : "倍速"}修正为 ${Math.round(sem)} BPM` };
    return { bpm: fromCreative, source: "creative_prompt", lyrical, reasonZh: `以创作说明 ${fromCreative} BPM 为准` };
  }
  const sem = pickSemantic();
  if (sem) return { bpm: Number(sem.toFixed(1)), source: "estimated", lyrical, reasonZh: `检测候选 ${cands.map(c => c.toFixed(0)).join("/")} BPM，按曲风语义取 ${sem.toFixed(0)}` };
  let bpm = input.estimatedBpm;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { bpm: Number(bpm.toFixed(1)), source: "estimated", lyrical, reasonZh: `检测 ${bpm.toFixed(0)} BPM` };
}
