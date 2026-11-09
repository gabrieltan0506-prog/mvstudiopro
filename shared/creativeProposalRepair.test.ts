import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  describeValidationErrorZh,
  describeZodIssueTextZh,
  normalizeMediaSections,
  repairJsonShape,
} from "./creativeProposalRepair";
import { creativeAudioEvidenceSchema, parseCreativeAudioEvidence } from "./creativeMediaEvidence";
import { musicMvAdvisorProposalSchema } from "./canvasMusicMv";

const emotion = { fromZh: "克制", toZh: "释然", triggerZh: "鼓点减少", musicZh: "人声展开", visualZh: "仅音频，未观察画面" };
const sec = (startSec: unknown, endSec: unknown, labelZh = "段") => ({ startSec, endSec, labelZh, heardZh: "人声与弦乐", emotion });
const times = (value: unknown) => ((value as { sections: Array<{ startSec: number; endSec: number }> }).sections).map(s => [s.startSec, s.endSec]);

describe("normalizeMediaSections · 时间边界确定性修复", () => {
  it("线上案例①：GLM 在 8 段后追加 {0,0,占位避免空段} → 丢弃第 9 段，前 8 段逐值不变", () => {
    const sections = [sec(0, 16.5, "前奏"), sec(16.5, 43.5), sec(43.5, 73.8), sec(73.8, 107.5), sec(107.5, 136), sec(136, 168), sec(168, 188.5), sec(188.5, 208.68, "尾奏"), sec(0, 0, "占位避免空段")];
    const { value, fixes } = normalizeMediaSections({ sections }, 208.68, 0.03);
    expect(times(value)).toEqual([[0, 16.5], [16.5, 43.5], [43.5, 73.8], [73.8, 107.5], [107.5, 136], [136, 168], [168, 188.5], [188.5, 208.68]]);
    expect(fixes).toEqual([{ index: 8, field: "section", before: { startSec: 0, endSec: 0, labelZh: "占位避免空段" }, after: undefined, reasonZh: "零长或倒序段落，已并入相邻段落" }]);
    expect((value as { sections: Array<{ heardZh: string }> }).sections.map(s => s.heardZh)).toEqual(Array(8).fill("人声与弦乐"));
  });
  it("线上案例②：末尾 {208.68,208.68,占位闭合段} 零长段同样丢弃", () => {
    const { value, fixes } = normalizeMediaSections({ sections: [sec(0, 100), sec(100, 208.68), sec(208.68, 208.68, "（占位闭合段）")] }, 208.68, 0.03);
    expect(times(value)).toEqual([[0, 100], [100, 208.68]]);
    expect(fixes.map(f => [f.index, f.field])).toEqual([[2, "section"]]);
  });
  it("线上案例③：7 段后追加 {0,208.68,全曲} 与 {0,0,占位} → 两条都丢弃，前 7 段不变", () => {
    const sections = [sec(0, 16), sec(16, 43), sec(43, 73), sec(73, 107), sec(107, 136), sec(136, 188), sec(188, 208.68, "尾奏"), sec(0, 208.68, "全曲"), sec(0, 0, "占位")];
    const { value, fixes } = normalizeMediaSections({ sections }, 208.68, 0.03);
    expect(times(value)).toEqual([[0, 16], [16, 43], [43, 73], [73, 107], [107, 136], [136, 188], [188, 208.68]]);
    expect(fixes.map(f => [f.index, f.field, f.reasonZh])).toEqual([
      [7, "startSec", "开始时间对齐上一段结束时间"],
      [7, "section", "对齐后无时间范围，已并入相邻段落"],
      [8, "section", "零长或倒序段落，已并入相邻段落"],
    ]);
  });
  it("衔接上一段的末段 endSec=0 补为歌曲时长；中间段 endSec=0 取下一段起点；段落文字原样保留", () => {
    const tail = normalizeMediaSections({ sections: [sec(0, 100), sec(100, 190), sec(190, 0, "淡出尾段")] }, 208.68, 0.03);
    expect(times(tail.value)).toEqual([[0, 100], [100, 190], [190, 208.68]]);
    expect(tail.fixes).toEqual([{ index: 2, field: "endSec", before: 0, after: 208.68, reasonZh: "无效结束时间补为歌曲时长" }]);
    expect((tail.value as { sections: Array<{ labelZh: string }> }).sections[2].labelZh).toBe("淡出尾段");
    const middle = normalizeMediaSections({ sections: [sec(0, 100), sec(100, 0, "坏段"), sec(150, 208.68)] }, 208.68, 0.03);
    expect(times(middle.value)).toEqual([[0, 100], [100, 150], [150, 208.68]]);
    expect(middle.fixes).toEqual([{ index: 1, field: "endSec", before: 0, after: 150, reasonZh: "无效结束时间补为下一段起点" }]);
    const missing = normalizeMediaSections({ sections: [sec(0, 100), sec(100, undefined, "缺尾")] }, 208.68, 0.03);
    expect(times(missing.value)).toEqual([[0, 100], [100, 208.68]]);
    expect(missing.fixes[0].reasonZh).toBe("缺失结束时间补为歌曲时长");
  });
  it("衔接的倒序段结束时间取下一段起点；不衔接的倒序段丢弃，后一段起点对齐上一段终点", () => {
    const linked = normalizeMediaSections({ sections: [sec(0, 50), sec(50, 40, "倒序"), sec(60, 120)] }, 120);
    expect(times(linked.value)).toEqual([[0, 50], [50, 60], [60, 120]]);
    expect(linked.fixes.map(f => f.reasonZh)).toEqual(["无效结束时间补为下一段起点"]);
    const stray = normalizeMediaSections({ sections: [sec(0, 50), sec(30, 20, "游离倒序"), sec(60, 120)] }, 120);
    expect(times(stray.value)).toEqual([[0, 50], [50, 120]]);
    expect(stray.fixes.map(f => f.reasonZh)).toEqual(["零长或倒序段落，已并入相邻段落", "开始时间对齐上一段结束时间"]);
  });
  it("末段缺尾补到歌曲时长，首段不从 0 归 0，缺失 endSec 用下一段起点补", () => {
    const { value, fixes } = normalizeMediaSections({ sections: [sec(1.2, 30), sec(30, undefined), sec(60, 118.9)] }, 120);
    expect(times(value)).toEqual([[0, 30], [30, 60], [60, 120]]);
    expect(fixes.map(f => [f.index, f.field, f.after])).toEqual([
      [1, "endSec", 60],
      [0, "startSec", 0],
      [2, "endSec", 120],
    ]);
  });
  it("数字字符串转数字；原本合法的分段不产生修复记录；全部零长时原样返回交给校验报错", () => {
    const strings = normalizeMediaSections({ sections: [sec("0", "60"), sec("60", "120")] }, 120);
    expect(times(strings.value)).toEqual([[0, 60], [60, 120]]);
    expect(strings.fixes).toHaveLength(4);
    const clean = { sections: [sec(0, 60), sec(60, 120)] };
    const untouched = normalizeMediaSections(clean, 120);
    expect(untouched.value).toBe(clean);
    expect(untouched.fixes).toEqual([]);
    const broken = { sections: [sec(5, 5), sec(7, 3)] };
    expect(normalizeMediaSections(broken, 120)).toEqual({ value: broken, fixes: [] });
    expect(normalizeMediaSections({ sections: [sec(0, 0)] }, undefined).fixes).toEqual([]);
  });
  it("修复后的听音证据能通过严格校验", () => {
    const decoded = { kind: "native_music_evidence_v1", sourceKey: "k", summaryZh: "摘要", sections: [sec(0, 100), sec(100, 208.68), sec(0, 0, "占位")], uncertaintiesZh: [] };
    expect(() => parseCreativeAudioEvidence(decoded, "k", 208.68)).toThrow();
    const normalized = normalizeMediaSections(decoded, 208.68, 0.1).value;
    expect(parseCreativeAudioEvidence(normalized, "k", 208.68).sections).toHaveLength(2);
  });
});

describe("repairJsonShape · zod issues 驱动的形状修复", () => {
  it("线上案例②：uncertainties 别名键改名为 uncertaintiesZh；字符串包成数组", () => {
    const schema = z.object({ uncertaintiesZh: z.array(z.string()), n: z.number() }).strict();
    const renamed = repairJsonShape({ uncertainties: ["a"], n: 1 }, schema);
    expect(renamed.value).toEqual({ uncertaintiesZh: ["a"], n: 1 });
    expect(renamed.issues).toBeNull();
    expect(renamed.fixes.map(f => f.reasonZh)).toEqual(["未知字段改名为 uncertaintiesZh"]);
    const wrapped = repairJsonShape({ uncertaintiesZh: "仅一条不确定", n: "3" }, schema);
    expect(wrapped.value).toEqual({ uncertaintiesZh: ["仅一条不确定"], n: 3 });
    expect(wrapped.fixes.map(f => [f.path, f.reasonZh])).toEqual([["uncertaintiesZh", "字符串包成单元素数组"], ["n", "数字字符串转数字"]]);
    const missing = repairJsonShape({ n: 2, extraZh: "x" }, schema);
    expect(missing.value).toEqual({ uncertaintiesZh: [], n: 2 });
    expect(missing.fixes.map(f => f.reasonZh)).toEqual(["删除未支持字段", "缺失数组补为空数组"]);
  });
  it("不编造内容：缺失必填字符串或 endSec≤0 不被形状修复吞掉，剩余 issues 原样返回", () => {
    const schema = z.object({ title: z.string(), endSec: z.number().positive() }).strict();
    const result = repairJsonShape({ endSec: 0 }, schema);
    expect(result.fixes).toEqual([]);
    expect(result.issues?.map(i => [i.code, i.path.join(".")])).toEqual([["invalid_type", "title"], ["too_small", "endSec"]]);
    expect(result.value).toEqual({ endSec: 0 });
  });
  it("真实 MV 方案 schema：案例② 的 uncertainties 别名在修复后能过 zod", () => {
    const base = { kind: "music_mv_v1", sourceKey: "k", summaryZh: "s", sections: [sec(0, 10)], uncertainties: "只有一条", concepts: [] };
    expect(musicMvAdvisorProposalSchema.safeParse(base).success).toBe(false);
    const repaired = repairJsonShape(base, musicMvAdvisorProposalSchema);
    expect((repaired.value as { uncertaintiesZh: string[] }).uncertaintiesZh).toEqual(["只有一条"]);
    // concepts 仍要求 4 个，这是内容问题，不由形状修复伪造
    expect(repaired.issues?.map(i => i.path.join("."))).toEqual(["concepts"]);
    expect(creativeAudioEvidenceSchema.safeParse(repairJsonShape({ kind: "native_music_evidence_v1", sourceKey: "k", summaryZh: "s", sections: [sec(0, 10)], uncertaintiesZh: "一条" }, creativeAudioEvidenceSchema).value).success).toBe(true);
  });
});

describe("describeZodIssuesZh · 用户可读中文", () => {
  it("线上日志原文 → 听音分段第 9 段结束时间无效", () => {
    const log = '[{"origin":"number","code":"too_small","minimum":0,"inclusive":false,"path":["sections",8,"endSec"],"message":"Too small: expected number to be >0"}]';
    expect(describeZodIssueTextZh(log)).toBe("听音分段第 9 段结束时间无效：应大于 0");
    expect(describeZodIssueTextZh('[{"expected":"array","code":"invalid_type","path":["uncertaintiesZh"],"message":"Invalid input: expected array, received string"}]')).toBe("不确定项类型不正确，应为数组");
    expect(describeZodIssueTextZh("普通错误")).toBeUndefined();
    expect(describeValidationErrorZh(new Error("听音段落未连续覆盖歌曲"))).toBe("听音段落未连续覆盖歌曲");
    const zodError = z.object({ concepts: z.array(z.string()).length(4) }).safeParse({ concepts: [] }).error!;
    expect(describeValidationErrorZh(zodError)).toBe("方案数量不足：至少 4 项");
  });
});
