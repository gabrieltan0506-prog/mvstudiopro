import { describe, expect, it, vi } from "vitest";
import { composeMusicMvFillPlan, repairFillWindows } from "./musicMvFillPlan";
import { CREATIVE_LLM_HOPS } from "./creativeLlmHops";

const cand = { mode: "stock_video" as const, queryEn: "neon city night", cameraZh: "推近", reasonZh: "能量高" };
describe("吟唱素材填充建议", () => {
  it("窗时间修复：裁到镜头、无缝、过短并入；超 6 秒算写坏", () => {
    const out = repairFillWindows({ id: "s", startSec: 36, endSec: 44 }, [
      { startSec: 35, endSec: 39, moodZh: "a", candidates: [cand] }, { startSec: 39.2, endSec: 39.5, moodZh: "b", candidates: [cand] }, { startSec: 39.5, endSec: 45, moodZh: "c", candidates: [cand] },
    ]);
    expect(out.map(w => [w.startSec, w.endSec])).toEqual([[36, 39.5], [39.5, 44]]);
    expect(() => repairFillWindows({ id: "s", startSec: 0, endSec: 10 }, [{ startSec: 0, endSec: 10, moodZh: "a", candidates: [cand] }])).toThrow(/超过 6 秒/);
  });
  it("三跳链产出逐窗候选并挂到镜头", async () => {
    const plan = { version: 1 as const, audioId: "a", audioDurationSec: 60, analysisBasis: "native_audio" as const, shots: [
      { id: "s3b", startSec: 36, endSec: 44, kind: "generated" as const, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [], fillRequested: true },
      { id: "s4", startSec: 44, endSec: 60, kind: "generated" as const, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [] },
    ] };
    const compose = vi.fn(async (_i: string, _in: any, _s: any, hop: any) => ({ text: JSON.stringify({ shots: [{ id: "s3b", windows: [{ startSec: 36, endSec: 40, moodZh: "上扬", candidates: [cand, { ...cand, mode: "stock_photo" }] }, { startSec: 40, endSec: 44, moodZh: "回落", candidates: [cand] }] }] }), model: hop.modelName }));
    const out = await composeMusicMvFillPlan({ plan, shotIds: ["s3b"], beatGrid: { bpm: 129, beatSec: 60 / 129, phaseSec: 0, source: "creative_prompt" }, creativePrompt: "" }, { hops: CREATIVE_LLM_HOPS, compose, save: async () => {} });
    expect(out.filled).toEqual(["s3b"]);
    expect(out.plan.shots[0]!.fill?.map(w => w.candidates[0]!.mode)).toEqual(["stock_video", "stock_video"]);
    expect(out.plan.shots[1]!.fill).toBeUndefined();
  });
});
