/**
 * MV 创作顾问 · 逐窗节拍阶段（1109）：为分镜里的生成画面段/演唱段写 2–4 秒窗（五项内容 + 演唱段对口型歌词句）。
 * 走同一三跳 fallback 链（runCreativeHopChain），每跳 JSON 解析 → 时间修复（shared/canvasMusicMvBeats）→ 合同校验；
 * 校验不过带原因重写，仍不过切下一跳。分块调用（每块 ≤6 镜），控制单次输出长度与超时风险。
 * 新方案由 askMusicMvAdvisor 在 refine 之后调用；旧方案（无逐窗字段）可单独调用本函数补窗。
 */
import {
  musicMvShotComplexitySchema,
  type MusicMvShotComplexity,
  musicMvShotBeatIssues,
  musicMvShotBeatSchema,
  type CanvasMusicMvPlan,
  type MusicMvBeatGrid,
  type MusicMvShotBeat,
} from "../../shared/canvasMusicMv";
import { beatsInRange, repairShotBeatWindows, singingWindowsFromLyricLines, type BeatFix } from "../../shared/canvasMusicMvBeats";
import { MUSIC_MV_BEATS_INSTRUCTIONS } from "../../shared/musicMvCraft";
import { mvCastFromCreative } from "../../shared/canvasMusicMvShotPrompt";
import type { CreativeLlmHop } from "./creativeLlmHops";
import { runCreativeHopChain, type HopSave } from "./creativeHopChain";

export const MV_BEATS_CHUNK_SHOTS = 6;

type Compose = (instructions: string, input: unknown, save: HopSave, hop: CreativeLlmHop) => Promise<{ text: string; model: string; inputSha256?: string }>;

export type MusicMvShotBeatsInput = {
  plan: CanvasMusicMvPlan;
  /** 需要出窗的镜头（缺省 = 全部非素材段）。 */
  shotIds?: string[];
  beatGrid: MusicMvBeatGrid & { strongBeatsSec?: number[] };
  lyrics: string;
  creativePrompt: string;
  concept?: { titleZh?: string; rationaleZh?: string };
  sections?: Array<{ startSec: number; endSec: number; labelZh: string; heardZh: string; emotion?: unknown }>;
  /** 歌词逐句秒位（歌曲绝对秒）：歌词对齐回执优先；没有时由顾问听歌给出（source=heard）。 */
  lyricLines?: { source: "confirmed" | "unconfirmed"; lines: Array<{ text: string; startSec: number; endSec: number }> };
  /** 演唱者（演唱镜对口型的人），与叙事主角区分，如 { genderZh: "男", descZh: "男歌手，清新克制" }。 */
  performer?: { genderZh?: string; descZh?: string };
};

export type MusicMvShotBeatsResult = {
  plan: CanvasMusicMvPlan;
  filledShotIds: string[];
  failedShotIds: string[];
  failuresZh: string[];
  fixes: BeatFix[];
};

function strip(text: string, n = 6000) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** 逐窗节拍分块出稿；某块三跳全败 → 该块镜头记 failed（调用方决定降级还是阻断）。 */
export async function composeMusicMvShotBeats(
  input: MusicMvShotBeatsInput,
  deps: { hops: readonly CreativeLlmHop[]; compose: Compose; save: HopSave },
): Promise<MusicMvShotBeatsResult> {
  const grid = input.beatGrid;
  const wanted = new Set(input.shotIds ?? input.plan.shots.filter(s => s.kind !== "footage").map(s => s.id));
  const targets = input.plan.shots.filter(s => wanted.has(s.id) && s.kind !== "footage");
  const chunks: (typeof targets)[] = [];
  for (let i = 0; i < targets.length; i += MV_BEATS_CHUNK_SHOTS) chunks.push(targets.slice(i, i + MV_BEATS_CHUNK_SHOTS));
  const filled = new Map<string, MusicMvShotBeat[]>();
  const chained = new Map<string, boolean>();
  const timings = new Map<string, "confirmed" | "unconfirmed">();
  const complexities = new Map<string, MusicMvShotComplexity>();
  const failedShotIds: string[] = [];
  const failuresZh: string[] = [];
  const fixes: BeatFix[] = [];
  // 1110 角色表：多人同框按角色表放行（不再写死单人）
  const cast = mvCastFromCreative(input.creativePrompt);
  for (let c = 0; c < chunks.length; c += 1) {
    const chunk = chunks[c]!;
    const from = chunk[0]!.startSec;
    const to = chunk[chunk.length - 1]!.endSec;
    const prev = input.plan.shots[input.plan.shots.findIndex(s => s.id === chunk[0]!.id) - 1];
    const payload = {
      task: "为下列镜头写逐窗节拍（秒锁窗），只输出 JSON",
      beatGrid: {
        bpm: grid.bpm,
        beatSec: grid.beatSec,
        segments: (grid.segments ?? []).filter(g => g.endSec > from && g.startSec < to).map(g => ({ startSec: g.startSec, endSec: g.endSec, energy: g.energy, pacing: g.pacingOverride ?? g.pacing })),
        beatsSec: beatsInRange(grid, from, to),
        strongBeatsSec: (grid.strongBeatsSec ?? []).filter(t => t >= from && t <= to),
      },
      creativePrompt: strip(input.creativePrompt, 3000),
      lyrics: strip(input.lyrics, 8000),
      concept: input.concept,
      ...(input.performer ? { performer: input.performer } : {}),
      ...(cast.length ? { cast } : {}),
      sections: (input.sections ?? []).filter(s => s.endSec > from && s.startSec < to),
      previousShot: prev ? { id: prev.id, kind: prev.kind, visualPrompt: prev.visualPrompt, cameraPrompt: prev.cameraPrompt } : undefined,
      shots: chunk.map(s => ({ id: s.id, kind: s.kind ?? "generated", startSec: s.startSec, endSec: s.endSec, visualPrompt: s.visualPrompt, cameraPrompt: s.cameraPrompt, lyricQuote: s.lyricQuote })),
    };
    const stage = `beats-${c + 1}`;
    const chainSave: HopSave = (name, value) => deps.save(`${stage}-${name}`.replace(/^beats-\d+-beats-/, `${stage}-`), value);
    try {
      const result = await runCreativeHopChain(
        deps.hops,
        "beats",
        chainSave,
        (hop, hopSave, repair) =>
          deps.compose(
            repair ? `${MUSIC_MV_BEATS_INSTRUCTIONS}\n上一版未通过服务端校验：${repair.reasonZh}。请逐条修正后重新输出完整 JSON。` : MUSIC_MV_BEATS_INSTRUCTIONS,
            repair ? { ...payload, repair } : payload,
            hopSave,
            hop,
          ),
        async (decoded, hopSave) => {
          const rows = (decoded as { shots?: unknown })?.shots;
          if (!Array.isArray(rows)) throw new Error("缺少 shots 数组");
          const out = new Map<string, MusicMvShotBeat[]>();
          const continuity = new Map<string, boolean>();
          const complexity = new Map<string, MusicMvShotComplexity>();
          const timing = new Map<string, "confirmed" | "unconfirmed">();
          const chunkFixes: BeatFix[] = [];
          for (const shot of chunk) {
            const row = rows.find(r => (r as { id?: unknown })?.id === shot.id) as { beats?: unknown } | undefined;
            if (!row || !Array.isArray(row.beats) || !row.beats.length) throw new Error(`镜头 ${shot.id} 缺少 beats`);
            const parsed = row.beats.map((w, i) => {
              const v = { ...(w as Record<string, unknown>) };
              if (v.lyricZh === "" || v.lyricZh === null) delete v.lyricZh;
              if (v.lipSync === null) delete v.lipSync;
              const res = musicMvShotBeatSchema.safeParse(v);
              if (!res.success) throw new Error(`镜头 ${shot.id} 第${i + 1}窗字段不合同：${res.error.issues.map(x => `${x.path.join(".")} ${x.message}`).join("；")}`);
              return res.data;
            });
            const repaired = repairShotBeatWindows(shot, parsed, grid);
            chunkFixes.push(...repaired.fixes);
            // 演唱段：唱句窗由用户确认版歌词时间表决定（对白式秒锁）；没有确认版就只出内容窗，出片前会被拦下
            if (shot.kind === "singing" && input.lyricLines?.lines.length) {
              const before = repaired.beats.map(w => [w.startSec, w.endSec]);
              repaired.beats = singingWindowsFromLyricLines(shot, repaired.beats, input.lyricLines.lines);
              chunkFixes.push({ shotId: shot.id, action: "singing_from_lyric_table", before, after: repaired.beats.map(w => [w.startSec, w.endSec]), reasonZh: `唱句窗按${input.lyricLines.source === "confirmed" ? "用户确认版" : "待确认版"}歌词时间表落位` });
              timing.set(shot.id, input.lyricLines.source);
            }
            const beats = repaired.beats.map(w => (shot.kind === "singing" ? w : { ...w, lipSync: false, lyricZh: undefined })).map(w => {
              const clean = { ...w };
              if (clean.lyricZh === undefined) delete clean.lyricZh;
              return clean;
            });
            const issues = musicMvShotBeatIssues({ ...shot, beats });
            if (issues.length) throw new Error(issues.join("；"));
            if (input.lyrics.trim()) {
              const bad = beats.find(w => w.lyricZh?.trim() && !input.lyrics.includes(w.lyricZh.trim()));
              if (bad) throw new Error(`镜头 ${shot.id} 的歌词句「${bad.lyricZh}」不是用户提供歌词原句`);
            }
            if (shot.kind === "singing" && shot.lyricQuote.trim() && !beats.some(w => w.lipSync && w.lyricZh?.trim()))
              throw new Error(`演唱镜 ${shot.id} 没有标出对口型的歌词句`);
            out.set(shot.id, beats);
            continuity.set(shot.id, (row as { continuesFromPrevious?: unknown }).continuesFromPrevious === true);
            const cx = musicMvShotComplexitySchema.safeParse((row as { complexity?: unknown }).complexity);
            if (!cx.success) throw new Error(`镜头 ${shot.id} 的 complexity 字段不合同：${cx.error.issues.map(x => `${x.path.join(".")} ${x.message}`).join("；")}`);
            complexity.set(shot.id, cx.data);
          }
          if (chunkFixes.length) await hopSave("repaired", { fixes: chunkFixes });
          return { out, chunkFixes, continuity, timing, complexity };
        },
      );
      result.value.out.forEach((beats, id) => filled.set(id, beats));
      result.value.continuity.forEach((flag, id) => chained.set(id, flag));
      result.value.timing.forEach((t, id) => timings.set(id, t));
      result.value.complexity.forEach((c, id) => complexities.set(id, c));
      fixes.push(...result.value.chunkFixes);
    } catch (error) {
      failedShotIds.push(...chunk.map(s => s.id));
      failuresZh.push(error instanceof Error ? error.message : String(error));
    }
  }
  const plan: CanvasMusicMvPlan = {
    ...input.plan,
    beatGrid: (({ strongBeatsSec: _s, ...map }) => map)(grid),
    shots: input.plan.shots.map((s, i) => {
      if (!filled.has(s.id)) return s;
      const prev = input.plan.shots[i - 1];
      // 接龙只在上一镜也是生成段时成立（素材段没有可抽的生成尾帧语义，首镜无上一镜）
      const continues = Boolean(chained.get(s.id) && prev && prev.kind !== "footage");
      return { ...s, beats: filled.get(s.id), ...(continues ? { continuesFromPrevious: true } : {}), ...(timings.has(s.id) ? { lyricTiming: timings.get(s.id) } : {}), ...(complexities.has(s.id) ? { complexity: complexities.get(s.id) } : {}) };
    }),
  };
  await deps.save("beats-summary", { filledShotIds: Array.from(filled.keys()), failedShotIds, failuresZh, fixes });
  return { plan, filledShotIds: Array.from(filled.keys()), failedShotIds, failuresZh, fixes };
}
