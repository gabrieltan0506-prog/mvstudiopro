import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "../../shared/manhuaPrevis";
import { validatePrevisReport } from "./manhuaPrevisReport";
import { compilePrevisScriptDraft } from "../../shared/manhuaPrevisScript";

function fixture() {
  const spec = createManhuaPrevisStudio(2).spec;
  spec.actors = [{ ...spec.actors[0], shape: "horse", start: [0, 0], end: [.4, 0], moveStartSec: 0, moveEndSec: 2,
    actions: [{ kind: "limp_front_left", startSec: 0, endSec: 2 }] }];
  return spec;
}

describe("左前腿跛行生产与恢复边界", () => {
  it("明确伤腿的剧本沿用既有四足身份，模糊跛行不猜左右", () => {
    const spec = fixture();
    spec.actors[0].assetRef = "horse-ref";
    spec.actors[0].actions = [];
    const input = { characters: [{ id: "horse-ref", label: "墨屠" }], currentSpec: spec };
    const mapped = compilePrevisScriptDraft({ ...input, shots: [{ index: 1, durationSec: 2, actionZh: "墨屠左前腿跛行。" }] });
    expect(mapped.errors).toEqual([]);
    expect(mapped.spec?.actors[0].actions[0].kind).toBe("limp_front_left");
    const unclear = compilePrevisScriptDraft({ ...input, shots: [{ index: 1, durationSec: 2, actionZh: "墨屠微跛。" }] });
    expect(unclear.unmapped).toHaveLength(1);
  });
  it("仅真实移动的整段四足配置可提交，不自动改变伤腿或物种", () => {
    const spec = fixture();
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    expect(manhuaPrevisSpecSchema.safeParse({ ...spec, actors: [{ ...spec.actors[0], shape: "human" }] }).success).toBe(false);
    expect(manhuaPrevisSpecSchema.safeParse({ ...spec, actors: [{ ...spec.actors[0], end: [0, 0] }] }).success).toBe(false);
    spec.actors[0].actions[0].endSec = 1;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("旧报告不能冒充新增跛行验收，伤腿不得出现在承重列表", () => {
    const spec = fixture();
    const actor = { id: spec.actors[0].id, nameZh: spec.actors[0].nameZh, bones: 19, contactError: 0, stanceDrift: 0, offscreenFrames: [] };
    const report = { frames: 48, fps: 24, warnings: [], actors: [actor] };
    expect(() => validatePrevisReport(report, spec)).toThrow();
    const samples = Array.from({ length: 48 }, (_, i) => ({ frame: i+1, leftFrontHeight: .145 + .275 * Math.sin(Math.PI * ((i % 18) / 17)) ** 2, supportKeys: ["0", "2"] }));
    expect(() => validatePrevisReport({ ...report, actors: [{ ...actor, limpSamples: samples }] }, spec)).not.toThrow();
    const frozen = samples.map(sample => ({ ...sample, leftFrontHeight: .48 }));
    expect(() => validatePrevisReport({ ...report, actors: [{ ...actor, limpSamples: frozen }] }, spec)).toThrow(/抬落差不足/);
    samples[20].supportKeys = ["0", "1"];
    expect(() => validatePrevisReport({ ...report, actors: [{ ...actor, limpSamples: samples }] }, spec)).toThrow();
  });
});
