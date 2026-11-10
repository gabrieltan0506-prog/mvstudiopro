import { describe, expect, it, vi } from "vitest";
import { composeMusicMvShotBeats } from "./musicMvShotBeats";
import { CREATIVE_LLM_HOPS } from "./creativeLlmHops";
import type { CanvasMusicMvPlan } from "../../shared/canvasMusicMv";

const plan: CanvasMusicMvPlan = {
  version: 1, audioId: "a", audioDurationSec: 20, analysisBasis: "native_audio",
  shots: [
    { id: "s1", startSec: 0, endSec: 6, kind: "generated", visualPrompt: "雨夜街口", cameraPrompt: "推近", lyricQuote: "", referenceIndices: [] },
    { id: "s2", startSec: 6, endSec: 12, kind: "generated", visualPrompt: "两人相拥", cameraPrompt: "环绕", lyricQuote: "", referenceIndices: [] },
    { id: "s3", startSec: 12, endSec: 20, kind: "footage", visualPrompt: "空镜", cameraPrompt: "素材", lyricQuote: "", referenceIndices: [], sourceClip: { assetId: "x", url: "https://x/x.mp4", durationSec: 30, sourceStartSec: 0 } },
  ],
};
const grid = { bpm: 129, beatSec: 60 / 129, phaseSec: 0.1, source: "creative_prompt" as const, strongBeatsSec: [] };
const win = (a: number, b: number) => ({ startSec: a, endSec: b, actionZh: "她抬眼", cameraZh: "中景推近", lightingZh: "霓虹冷光", moodZh: "克制", sfxZh: "雨声" });

describe("逐窗节拍阶段（三跳链）", () => {
  it("合格回包：窗界修复后挂到镜头，带接龙与复杂度；素材段不出窗", async () => {
    const saved = new Map<string, unknown>();
    const compose = vi.fn(async (_i: string, input: any, save: any, hop: any) => {
      expect(input.shots.map((s: any) => s.id)).toEqual(["s1", "s2"]);
      await save("raw", {});
      return { text: JSON.stringify({ shots: [
        { id: "s1", continuesFromPrevious: false, complexity: { people: 1, action: "light", contact: false, cameraSetups: 1, scenes: 1 }, beats: [win(0, 3.1), win(3.1, 6)] },
        { id: "s2", continuesFromPrevious: true, complexity: { people: 2, action: "strong", contact: true, cameraSetups: 2, scenes: 1 }, beats: [win(6, 9), win(9, 12)] },
      ] }), model: hop.modelName };
    });
    const out = await composeMusicMvShotBeats({ plan, beatGrid: grid, lyrics: "", creativePrompt: "129 BPM" }, { hops: CREATIVE_LLM_HOPS, compose, save: async (n, v) => { saved.set(n, v); } });
    expect(out.failedShotIds).toEqual([]);
    const s1 = out.plan.shots[0]!, s2 = out.plan.shots[1]!;
    expect(s1.beats?.length).toBe(2);
    expect(s1.continuesFromPrevious).toBeUndefined();
    expect(s2.continuesFromPrevious).toBe(true);
    expect(s2.complexity?.people).toBe(2);
    expect(out.plan.shots[2]!.beats).toBeUndefined();
    expect(out.plan.beatGrid?.bpm).toBe(129);
    expect(Array.from(saved.keys())).toContain("beats-1-hop-used");
  });

  it("写坏（缺 complexity）带原因重写；三跳全败 → 记 failed，不伪造窗", async () => {
    const compose = vi.fn(async (_i: string, _in: any, _s: any, hop: any) => ({ text: JSON.stringify({ shots: [{ id: "s1", beats: [win(0, 6)] }, { id: "s2", beats: [win(6, 12)] }] }), model: hop.modelName }));
    const out = await composeMusicMvShotBeats({ plan, beatGrid: grid, lyrics: "", creativePrompt: "" }, { hops: CREATIVE_LLM_HOPS, compose, save: async () => {} });
    expect(compose).toHaveBeenCalledTimes(CREATIVE_LLM_HOPS.length * 2);
    expect(out.failedShotIds).toEqual(["s1", "s2"]);
    expect(out.plan.shots[0]!.beats).toBeUndefined();
    expect(out.failuresZh[0]).toContain("complexity");
  });
});
