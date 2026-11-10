/**
 * MV 吟唱区间素材填充建议（1109）：顾问（同一三跳链）按情绪与能量逐窗推荐 Pexels 视频直接剪入 / 照片推拉 / 参考生视频，
 * 每个候选带抽屉搜索关键词与理由。只做时间修复（裁到镜头、无缝、过短并入），内容不改写。
 */
import { musicMvFillWindowSchema, type CanvasMusicMvPlan, type MusicMvBeatGrid, type MusicMvFillWindow } from "../../shared/canvasMusicMv";
import { beatsInRange } from "../../shared/canvasMusicMvBeats";
import { MUSIC_MV_FILL_INSTRUCTIONS } from "../../shared/musicMvCraft";
import type { CreativeLlmHop } from "./creativeLlmHops";
import { runCreativeHopChain, type HopSave } from "./creativeHopChain";

type Compose = (instructions: string, input: unknown, save: HopSave, hop: CreativeLlmHop) => Promise<{ text: string; model: string; inputSha256?: string }>;

/** 窗时间修复：裁到镜头、首尾补齐、相邻无缝；<0.5 秒并入前窗；>6 秒视为写坏交重写。 */
export function repairFillWindows(shot: { id: string; startSec: number; endSec: number }, raw: MusicMvFillWindow[]): MusicMvFillWindow[] {
  const rows = raw
    .map(w => ({ ...w, startSec: Math.max(shot.startSec, w.startSec), endSec: Math.min(shot.endSec, w.endSec) }))
    .filter(w => w.endSec - w.startSec > 0.01)
    .sort((a, b) => a.startSec - b.startSec);
  if (!rows.length) throw new Error(`镜头 ${shot.id} 没有可用的填充窗`);
  rows[0]!.startSec = shot.startSec;
  for (let i = 1; i < rows.length; i++) rows[i - 1]!.endSec = rows[i]!.startSec;
  rows[rows.length - 1]!.endSec = shot.endSec;
  const out: MusicMvFillWindow[] = [];
  for (const w of rows) {
    if (w.endSec - w.startSec < 0.5 && out.length) { out[out.length - 1]!.endSec = w.endSec; continue; }
    out.push(w);
  }
  for (const w of out) if (w.endSec - w.startSec > 6 + 1e-6) throw new Error(`镜头 ${shot.id} 有 ${(w.endSec - w.startSec).toFixed(1)} 秒的窗，超过 6 秒`);
  return out.map(w => ({ ...w, startSec: Math.round(w.startSec * 1000) / 1000, endSec: Math.round(w.endSec * 1000) / 1000 }));
}

export async function composeMusicMvFillPlan(
  input: { plan: CanvasMusicMvPlan; shotIds: string[]; beatGrid: MusicMvBeatGrid; creativePrompt: string; lyricLines?: Array<{ text: string; startSec: number; endSec: number; kind?: string }> },
  deps: { hops: readonly CreativeLlmHop[]; compose: Compose; save: HopSave },
): Promise<{ plan: CanvasMusicMvPlan; failuresZh: string[]; filled: string[] }> {
  const targets = input.plan.shots.filter(s => input.shotIds.includes(s.id));
  if (!targets.length) return { plan: input.plan, failuresZh: [], filled: [] };
  const from = targets[0]!.startSec;
  const to = targets[targets.length - 1]!.endSec;
  const payload = {
    task: "为吟唱区间镜头给逐窗素材填充建议，只输出 JSON",
    beatGrid: { bpm: input.beatGrid.bpm, beatSec: input.beatGrid.beatSec, beatsSec: beatsInRange(input.beatGrid, from, to) },
    audioSegments: (input.beatGrid.segments ?? []).filter(g => g.endSec > from && g.startSec < to).map(g => ({ startSec: g.startSec, endSec: g.endSec, energy: g.energy, pacing: g.pacingOverride ?? g.pacing })),
    creativePrompt: input.creativePrompt.slice(0, 3000),
    chantLines: (input.lyricLines ?? []).filter(l => l.kind === "chant" && l.endSec > from && l.startSec < to),
    shots: targets.map(s => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, visualPrompt: s.visualPrompt, cameraPrompt: s.cameraPrompt })),
  };
  const chainSave: HopSave = (name, value) => deps.save(name, value);
  try {
    const result = await runCreativeHopChain(
      deps.hops, "fill", chainSave,
      (hop, hopSave, repair) => deps.compose(repair ? `${MUSIC_MV_FILL_INSTRUCTIONS}\n上一版未通过服务端校验：${repair.reasonZh}。请逐条修正后重新输出完整 JSON。` : MUSIC_MV_FILL_INSTRUCTIONS, repair ? { ...payload, repair } : payload, hopSave, hop),
      async (decoded, hopSave) => {
        const rows = (decoded as { shots?: unknown })?.shots;
        if (!Array.isArray(rows)) throw new Error("缺少 shots 数组");
        const out = new Map<string, MusicMvFillWindow[]>();
        for (const shot of targets) {
          const row = rows.find(r => (r as { id?: unknown })?.id === shot.id) as { windows?: unknown } | undefined;
          if (!row || !Array.isArray(row.windows) || !row.windows.length) throw new Error(`镜头 ${shot.id} 缺少 windows`);
          const parsed = row.windows.map((w, i) => {
            const res = musicMvFillWindowSchema.safeParse(w);
            if (!res.success) throw new Error(`镜头 ${shot.id} 第${i + 1}窗不合同：${res.error.issues.map(x => `${x.path.join(".")} ${x.message}`).join("；")}`);
            return res.data;
          });
          out.set(shot.id, repairFillWindows(shot, parsed));
        }
        await hopSave("repaired", Object.fromEntries(out));
        return out;
      },
    );
    const plan: CanvasMusicMvPlan = { ...input.plan, shots: input.plan.shots.map(s => (result.value.has(s.id) ? { ...s, fill: result.value.get(s.id) } : s)) };
    return { plan, failuresZh: [], filled: Array.from(result.value.keys()) };
  } catch (error) {
    return { plan: input.plan, failuresZh: [error instanceof Error ? error.message : String(error)], filled: [] };
  }
}
