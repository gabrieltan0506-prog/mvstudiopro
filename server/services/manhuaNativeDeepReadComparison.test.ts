import { describe, expect, it } from "vitest";
import { auditNativeDeepReadStructuringEvidence } from "./manhuaNativeDeepReadComparison";

const source = () => ({
  shots: [
    { startSec: 0, endSec: 2, evidenceRole: "story", hintZh: "男子站在门边", actionZh: "保持站立" },
    { startSec: 2, endSec: 4, evidenceRole: "story", hintZh: "男子站在门边", actionZh: "保持站立" },
  ],
  keyMoments: [{ atSec: 1, kindZh: "剧情", noteZh: "门打开" }],
  subtitles: [{ atSec: 1, textZh: "来了" }],
  audioResolution: [{ chunkIndex: 0, analysis: { audioTrack: [{ fromSec: 0, toSec: 4, bgmZh: "低声弦乐", cues: [{ atSec: 1, kind: "sfx", detailZh: "开门声" }] }] } }],
});

describe("整形两路同源证据对账", () => {
  it("真实相同的表现可以重复，可选字段缺省不阻断；不修改输入", () => {
    const input = source(); const before = structuredClone(input);
    expect(auditNativeDeepReadStructuringEvidence([input], structuredClone(input)).passed).toBe(true);
    expect(input).toEqual(before);
  });
  it("时间轴仍100%但合并两个真实镜头为一条时不能通过", () => {
    const input = source(); const output = structuredClone(input);
    output.shots = [{ ...output.shots[0]!, endSec: 4 }];
    const result = auditNativeDeepReadStructuringEvidence([input], output);
    expect(result.passed).toBe(false);
    expect(result.checks.find(row => row.kind === "shots")?.missing).toHaveLength(2);
  });
  it.each(["subtitles", "audioTracks", "audioCues", "keyMoments"] as const)("丢失%s不被其他数组和覆盖率掩盖", kind => {
    const input = source(); const output = structuredClone(input);
    if (kind === "subtitles") output.subtitles = [];
    if (kind === "keyMoments") output.keyMoments = [];
    if (kind === "audioTracks") output.audioResolution[0]!.analysis.audioTrack = [];
    if (kind === "audioCues") output.audioResolution[0]!.analysis.audioTrack[0]!.cues = [];
    expect(auditNativeDeepReadStructuringEvidence([input], output).checks.find(row => row.kind === kind)?.missing).toHaveLength(1);
  });
  it("同数量的字幕替换和声音事件挪秒仍能发现，合法同源重复去重通过", () => {
    const input = source(); const output = structuredClone(input);
    output.subtitles[0]!.textZh = "别走";
    output.audioResolution[0]!.analysis.audioTrack[0]!.cues[0]!.atSec = 3;
    const result = auditNativeDeepReadStructuringEvidence([input], output);
    expect(result.passed).toBe(false);
    expect(result.checks.find(row => row.kind === "subtitles")?.unexpected).toHaveLength(1);
    expect(result.checks.find(row => row.kind === "audioCues")?.unexpected).toHaveLength(1);
    expect(auditNativeDeepReadStructuringEvidence([input, input], structuredClone(input)).passed).toBe(true);
  });
  it("广告移到账目后仍保留来源区间", () => {
    const input = { ...source(), shots: [...source().shots, { startSec: 4, endSec: 5, evidenceRole: "non_story_ad", hintZh: "", actionZh: "" }] };
    const output = { ...source(), excludedAdRanges: [{ startSec: 4, endSec: 5 }] };
    expect(auditNativeDeepReadStructuringEvidence([input], output).passed).toBe(true);
    expect(auditNativeDeepReadStructuringEvidence([input], source()).passed).toBe(false);
  });
});
