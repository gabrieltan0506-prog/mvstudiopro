import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_GRADE_LUT_ID_RE, concatGradeSchema } from "@shared/colorGrade";
import { montageGradeAdviceStory } from "@/components/canvas/MontageGradeAdvice";
import {
  MONTAGE_ADVISOR_GRADE_NOT_EXPLICIT_ZH,
  MONTAGE_LUT_GROUPS,
  MONTAGE_LUT_IDS,
  MONTAGE_TRANSITION_RANGE,
  MONTAGE_FINISH_ADVISOR_HELP,
  addMontageSegment,
  applyAdvisorMontageFinish,
  applyMontageSegmentsDraft,
  checkMontageSegments,
  montageFinishKey,
  montageFinishParams,
  montageOutputSec,
  patchMontageSegment,
  readMontageFinishes,
  readMontageJunctionCheck,
  removeMontageSegment,
  setMontageAutoMatch,
  setMontageCrossfade,
  montageTransitionBlockReason,
  normalizeMontageGrade,
  normalizeMontageTransition,
  patchMontageGradeAll,
  readMontageFinish,
  type MontageFinish,
} from "./montageFinish";

type ManifestEntry = { id: string; intensity: "subtle" | "standard"; labelZh: string };
const manifest = JSON.parse(readFileSync("server/assets/luts/manifest.json", "utf8")) as ManifestEntry[];


const EXPLICIT = { source: "user_explicit", userQuoteZh: "饱和度0.8" } as const;

describe("调色/转场草稿 ↔ concat 参数", () => {
  it("草稿经存储往返不变，组装结果通过共享 concatGradeSchema", () => {
    const draft: MontageFinish = {
      grade: { all: { lutId: "golden_hour_subtle", saturation: 0.8 }, clips: [null, { exposure: 0.2 }, { contrast: 1.2 }], referenceClipIndex: 1 },
      transition: { kind: "wipeleft", durationSec: 0.8 },
    };
    const restored = readMontageFinish(JSON.parse(JSON.stringify(draft)));
    expect(restored).toEqual(draft);
    const params = montageFinishParams(restored!, 3, false);
    expect(params).toEqual({
      grade: { all: { lutId: "golden_hour_subtle", saturation: 0.8 }, clips: [null, { exposure: 0.2 }, { contrast: 1.2 }], referenceClipIndex: 1 },
      transition: { kind: "wipeleft", durationSec: 0.8 },
    });
    expect(concatGradeSchema.safeParse(params.grade).success).toBe(true);
    expect(normalizeMontageGrade(params.grade)).toEqual(params.grade);
  });

  it("草稿读回：缺省为空，格式错误为 null（不猜）", () => {
    expect(readMontageFinish(undefined)).toEqual({});
    expect(readMontageFinish("x")).toBeNull();
    expect(readMontageFinish([])).toBeNull();
    expect(readMontageFinish({ transition: { kind: "zoom", durationSec: 0.5 } })).toBeNull();
    expect(readMontageFinish({ transition: { kind: "fade", durationSec: 0.05 } })).toBeNull();
    expect(readMontageFinish({ grade: { all: { lutId: "../../etc/passwd" } } })).toBeNull();
    expect(readMontageFinish({ grade: { all: {} , extra: 1 } })).toBeNull();
    expect(readMontageFinish({ transition: { kind: "fade" } })).toEqual({ transition: { kind: "fade", durationSec: MONTAGE_TRANSITION_RANGE.default } });
  });

  it("转场时长边界与一位小数取整", () => {
    expect(normalizeMontageTransition({ kind: "fade", durationSec: 0.1 }).durationSec).toBe(0.1);
    expect(normalizeMontageTransition({ kind: "fade", durationSec: 2 }).durationSec).toBe(2);
    expect(normalizeMontageTransition({ kind: "dissolve", durationSec: 0.74 }).durationSec).toBe(0.7);
    expect(() => normalizeMontageTransition({ kind: "fade", durationSec: 2.01 })).toThrow("0.1–2");
    expect(() => normalizeMontageTransition({ kind: "fade", durationSec: Number.NaN })).toThrow();
    expect(() => normalizeMontageTransition(null)).toThrow("格式错误");
  });

  it("逐段全中性时不下发 clips；只剩代表镜头时不下发 grade；单段不带代表镜头", () => {
    expect(montageFinishParams({ grade: { clips: [{ saturation: 1 }, null], referenceClipIndex: 0 } }, 2, false)).toEqual({});
    expect(montageFinishParams({ grade: { all: { saturation: 0.5 }, clips: [{ contrast: 1 }, null] } }, 2, false)).toEqual({ grade: { all: { saturation: 0.5 } } });
    expect(montageFinishParams({ grade: { all: { saturation: 0.5 }, referenceClipIndex: 0 } }, 1, false)).toEqual({ grade: { all: { saturation: 0.5 } } });
    expect(() => montageFinishParams({ grade: { all: { saturation: 0.5 }, referenceClipIndex: 2 } }, 2, false)).toThrow("代表镜头");
  });
});

describe("LUT 白名单与轻/标准档", () => {
  it("清单 20 个 id，前端预设与之一一对应、不重复、符合服务端 id 规则", () => {
    expect(manifest).toHaveLength(20);
    expect(new Set(MONTAGE_LUT_IDS).size).toBe(MONTAGE_LUT_IDS.length);
    expect([...MONTAGE_LUT_IDS].sort()).toEqual(manifest.map(m => m.id).sort());
    for (const id of MONTAGE_LUT_IDS) expect(id).toMatch(COLOR_GRADE_LUT_ID_RE);
  });

  it("白名单外 id（含逐段）即使格式合法也被拒绝", () => {
    expect(() => normalizeMontageGrade({ all: { lutId: "teal_orange_extreme" } })).toThrow("调色预设不存在");
    expect(() => normalizeMontageGrade({ clips: [null, { lutId: "basic_sepia" }] })).toThrow("调色预设不存在");
    expect(() => normalizeMontageGrade({ all: { lutId: "Basic_Warm" } })).toThrow();
    for (const id of MONTAGE_LUT_IDS) expect(normalizeMontageGrade({ all: { lutId: id } })).toEqual({ all: { lutId: id } });
  });

  it("subtle → 「轻」、成对 standard → 「标准」；无轻档的单档预设不标档位", () => {
    const labels = new Map(MONTAGE_LUT_GROUPS.flatMap(g => g.presets.map(p => [p.id, p.label] as const)));
    const ids = new Set(manifest.map(m => m.id));
    for (const m of manifest) {
      const label = labels.get(m.id)!;
      const base = m.id.replace(/_(subtle|standard)$/, "");
      const paired = ids.has(`${base}_subtle`) && ids.has(`${base}_standard`);
      if (m.intensity === "subtle") {
        expect(label).toMatch(/· 轻$/);
        expect(ids.has(`${base}_standard`)).toBe(true);
      } else if (paired) expect(label).toMatch(/· 标准$/);
      else expect(label).not.toMatch(/轻|标准/);
      // 同组轻/标准两档相邻，便于下拉选择
      if (paired && m.intensity === "subtle") {
        const all = MONTAGE_LUT_IDS as string[];
        expect(all.indexOf(`${base}_standard`)).toBe(all.indexOf(m.id) + 1);
      }
    }
  });
});

describe("转场禁用", () => {
  const finish: MontageFinish = { grade: { all: { lutId: "basic_cool" } }, transition: { kind: "fade", durationSec: 0.5 } };
  it("有字幕或单段时不下发转场，但调色照常下发", () => {
    expect(montageTransitionBlockReason(3, true)).toContain("字幕");
    expect(montageTransitionBlockReason(1, false)).toContain("单段");
    expect(montageTransitionBlockReason(0, false)).toContain("单段");
    expect(montageTransitionBlockReason(2, false)).toBe("");
    expect(montageFinishParams(finish, 3, true)).toEqual({ grade: { all: { lutId: "basic_cool" } } });
    expect(montageFinishParams(finish, 1, false)).toEqual({ grade: { all: { lutId: "basic_cool" } } });
    expect(montageFinishParams(finish, 2, false).transition).toEqual({ kind: "fade", durationSec: 0.5 });
  });
  it("kind=none 不下发", () => {
    expect(montageFinishParams({ transition: { kind: "none", durationSec: 1 } }, 4, false)).toEqual({});
  });
});

describe("默认不传 grade 时 concat 参数与改前一致", () => {
  const base = { clips: ["gs://test-only/a.mp4", "gs://test-only/a.mp4"], trims: [{ startSec: 0, endSec: 1 }, { startSec: 2, endSec: 3 }], width: 720, height: 1280, fps: 30 };
  it.each([
    ["undefined", undefined],
    ["空草稿", {}],
    ["中性滑杆", { grade: patchMontageGradeAll(undefined, { saturation: 1, contrast: 1, color_temperature: 6500 }) }],
    ["还原后", { grade: patchMontageGradeAll(patchMontageGradeAll(undefined, { lutId: "basic_warm" }), { lutId: undefined }) }],
  ] as Array<[string, MontageFinish | undefined]>)("%s → 无新增字段", (_, f) => {
    const extra = montageFinishParams(f, 2, false);
    expect(extra).toEqual({});
    const params = { ...base, ...extra };
    expect(Object.keys(params)).toEqual(Object.keys(base));
    expect(params).toEqual(base);
  });

  it("滑杆回到中性即删键，保留逐段设置", () => {
    const g = patchMontageGradeAll({ clips: [{ exposure: 0.1 }] }, { saturation: 0.6 });
    expect(g).toEqual({ clips: [{ exposure: 0.1 }], all: { saturation: 0.6 } });
    expect(patchMontageGradeAll(g, { saturation: 1 })).toEqual({ clips: [{ exposure: 0.1 }] });
    expect(patchMontageGradeAll({ all: { saturation: 0.6 } }, { saturation: 1 })).toBeUndefined();
  });
});

describe("按方案各存一份 + 顾问写入即核对切点数", () => {
  it("键 = 方案序号:标题；读回逐份校验，任一份坏则整体 null", () => {
    expect(montageFinishKey(0, "预告")).toBe("1:预告");
    const ok = { "1:预告": { grade: { all: { lutId: "basic_warm" } } }, "2:短版": { transition: { kind: "fade", durationSec: 0.5 } } };
    expect(readMontageFinishes(ok)).toEqual(ok);
    expect(readMontageFinishes(undefined)).toEqual({});
    expect(readMontageFinishes({ ...ok, "3:坏": { grade: { all: { lutId: "made_up" } } } })).toBeNull();
    expect(readMontageFinishes([])).toBeNull();
  });

  it("逐段调色项数 ≠ 本方案切点数 → 直接拒绝并给中文原因；相等才写入", () => {
    const action = { operation: "grade", ...EXPLICIT, grade: { clips: [{ saturation: 0.8 }, null, null] } };
    expect(() => applyAdvisorMontageFinish({}, action, 2)).toThrow("逐段调色有3项，本方案有2个切点，须一一对应，未改动");
    expect(applyAdvisorMontageFinish({}, action, 3)).toEqual({ grade: { clips: [{ saturation: 0.8 }, null, null] } });
    expect(() => applyAdvisorMontageFinish({}, { operation: "grade", ...EXPLICIT, grade: { all: { saturation: 0.8 }, referenceClipIndex: 2 } }, 2)).toThrow("代表镜头第3段超出本方案2个切点，未改动");
  });

  it("顾问 grade 须带 user_explicit 与用户原话才写草稿，否则拒绝并指向『AI 调色建议』", () => {
    const grade = { all: { saturation: 0.8 } };
    expect(() => applyAdvisorMontageFinish({}, { operation: "grade", grade }, 2)).toThrow(MONTAGE_ADVISOR_GRADE_NOT_EXPLICIT_ZH);
    expect(MONTAGE_ADVISOR_GRADE_NOT_EXPLICIT_ZH).toBe("调色方案请用『AI 调色建议』生成");
    expect(() => applyAdvisorMontageFinish({}, { operation: "grade", source: "advisor", userQuoteZh: "饱和度0.8", grade }, 2)).toThrow(MONTAGE_ADVISOR_GRADE_NOT_EXPLICIT_ZH);
    expect(() => applyAdvisorMontageFinish({}, { operation: "grade", source: "user_explicit", userQuoteZh: "  ", grade }, 2)).toThrow(MONTAGE_ADVISOR_GRADE_NOT_EXPLICIT_ZH);
    expect(() => applyAdvisorMontageFinish({}, { operation: "grade", source: "user_explicit", grade }, 2)).toThrow(MONTAGE_ADVISOR_GRADE_NOT_EXPLICIT_ZH);
    expect(applyAdvisorMontageFinish({}, { operation: "grade", ...EXPLICIT, grade }, 2)).toEqual({ grade: { all: { saturation: 0.8 } } });
    // 还原原片色彩不是新调色方案，不要求原话
    expect(applyAdvisorMontageFinish({ grade: { all: { saturation: 0.8 } } }, { operation: "grade", grade: null }, 2)).toEqual({ grade: undefined });
    for (const k of ["source=user_explicit", "userQuoteZh", "gradeAdvice", "userRequestZh"]) expect(MONTAGE_FINISH_ADVISOR_HELP).toContain(k);
  });

  it("gradeAdvice 不直接写草稿；用户要求放在 storyZh 最前送「AI 调色建议」", () => {
    expect(() => applyAdvisorMontageFinish({}, { operation: "gradeAdvice" } as { operation: string }, 2)).toThrow("该操作不是调色或转场设置");
    expect(montageGradeAdviceStory("剧情时间线", "雨景偏冷一点、结尾更亮")).toBe("用户调色要求：雨景偏冷一点、结尾更亮\n剧情时间线");
    expect(montageGradeAdviceStory("剧情", undefined)).toBe("剧情");
    expect(montageGradeAdviceStory("长".repeat(9000), "结尾更亮").startsWith("用户调色要求：结尾更亮\n")).toBe(true);
    expect(montageGradeAdviceStory("长".repeat(9000), "结尾更亮")).toHaveLength(8000);
  });

  it("transition 枚举放开 dissolve/wipeleft；提示含 20 个预设与色温方向", () => {
    expect(applyAdvisorMontageFinish({}, { operation: "transition", transition: "wipeleft" }, 2)).toEqual({ transition: { kind: "wipeleft", durationSec: MONTAGE_TRANSITION_RANGE.default } });
    for (const id of MONTAGE_LUT_IDS) expect(MONTAGE_FINISH_ADVISOR_HELP).toContain(id);
    expect(MONTAGE_FINISH_ADVISOR_HELP).toContain("数值越低越暖");
  });
});

describe("分段调色 segments / crossfadeSec / autoMatchJunctions（共享 concatGradeSchema）", () => {
  const segs = [
    { startSec: 0, endSec: 4, lutId: "golden_hour_subtle" },
    { startSec: 4, endSec: 7.5, saturation: 0.8 },
    { startSec: 7.5, endSec: 10 },
  ];
  it("连续、不重叠、覆盖片长才通过；首段须从0起；每段长于段间过渡", () => {
    expect(checkMontageSegments(segs, 10)).toBe("");
    expect(checkMontageSegments([], 10)).toBe("");
    expect(checkMontageSegments([{ startSec: 0.5, endSec: 10 }], 10)).toContain("从0秒");
    expect(checkMontageSegments([{ startSec: 0, endSec: 4 }, { startSec: 3.5, endSec: 10 }], 10)).toContain("重叠");
    expect(checkMontageSegments([{ startSec: 0, endSec: 4 }, { startSec: 4.5, endSec: 10 }], 10)).toContain("空档");
    expect(checkMontageSegments(segs, 12)).toContain("成片结尾12.0秒");
    expect(checkMontageSegments([{ startSec: 0, endSec: 1 }, { startSec: 1, endSec: 10 }], 10, 1.5)).toContain("短于段间过渡");
  });
  it("格式：非一位小数、过渡超2秒、白名单外预设、未知字段、与逐段同用、无分段带渐变均拒绝", () => {
    expect(readMontageFinish({ grade: { segments: [{ startSec: 0, endSec: 10.05 }] } })).toBeNull();
    expect(readMontageFinish({ grade: { segments: [{ startSec: 0, endSec: 10 }], crossfadeSec: 2.5 } })).toBeNull();
    expect(readMontageFinish({ grade: { segments: [{ startSec: 0, endSec: 10, lutId: "made_up" }] } })).toBeNull();
    expect(readMontageFinish({ grade: { segments: [{ startSec: 0, endSec: 10, foo: 1 }] } })).toBeNull();
    expect(readMontageFinish({ grade: { segments: [{ startSec: 0, endSec: 10 }], clips: [null] } })).toBeNull();
    expect(readMontageFinish({ grade: { crossfadeSec: 0.5 } })).toBeNull();
    expect(readMontageFinish({ grade: { segments: [{ startSec: 0, endSec: 10 }], autoMatchJunctions: "yes" } })).toBeNull();
    expect(() => montageFinishParams({ grade: { segments: [{ startSec: 0, endSec: 4 }, { startSec: 5, endSec: 10, saturation: 0.5 }] } }, 3, false, 10)).toThrow("空档");
  });
  it("采用时下发：中性段剥离校正、全中性不下发 segments（连同渐变/接点修正）；结果过共享 schema", () => {
    const draft = readMontageFinish(JSON.parse(JSON.stringify({ grade: { segments: segs, crossfadeSec: 0.5, autoMatchJunctions: true } })))!;
    const params = montageFinishParams(draft, 3, false, 10);
    expect(params).toEqual({ grade: { segments: segs, crossfadeSec: 0.5, autoMatchJunctions: true } });
    expect(concatGradeSchema.safeParse(params.grade).success).toBe(true);
    expect(montageFinishParams({ grade: { segments: [{ startSec: 0, endSec: 5, saturation: 1 }, { startSec: 5, endSec: 10 }], crossfadeSec: 0.5, autoMatchJunctions: true } }, 3, false, 10)).toEqual({});
    expect(() => montageFinishParams(draft, 3, false, 9)).toThrow("成片结尾");
    expect(() => montageFinishParams(draft, 3, false)).toThrow("缺少成片时长");
  });
  it("默认无分段：参数与改前一致（不传 outputSec 也不报错）", () => {
    expect(montageFinishParams({}, 3, false)).toEqual({});
    expect(montageFinishParams({ grade: { all: { lutId: "basic_warm" } } }, 3, false)).toEqual({ grade: { all: { lutId: "basic_warm" } } });
  });
  it("成片时长：切点总长扣除实际下发的重叠转场", () => {
    const cuts = [{ startSec: 0, endSec: 4 }, { startSec: 6, endSec: 9 }, { startSec: 10, endSec: 13 }];
    expect(montageOutputSec(cuts, {}, false)).toBe(10);
    expect(montageOutputSec(cuts, { transition: { kind: "fade", durationSec: 0.5 } }, false)).toBe(9);
    expect(montageOutputSec(cuts, { transition: { kind: "fade", durationSec: 0.5 } }, true)).toBe(10);
  });
  it("界面增删改：始终连续；剩一段回到全片调色并清掉渐变/接点修正", () => {
    let g = addMontageSegment(undefined, 10);
    expect(g?.segments).toEqual([{ startSec: 0, endSec: 5 }, { startSec: 5, endSec: 10 }]);
    g = addMontageSegment(g, 10);
    expect(g?.segments?.map(s => [s.startSec, s.endSec])).toEqual([[0, 5], [5, 7.5], [7.5, 10]]);
    g = patchMontageSegment(g, 1, { endSec: 8.2, saturation: 0.6 });
    expect(g?.segments?.[1]).toEqual({ startSec: 5, endSec: 8.2, saturation: 0.6 });
    expect(g?.segments?.[2].startSec).toBe(8.2);
    g = patchMontageSegment(g, 1, { saturation: 1 });
    expect(g?.segments?.[1]).toEqual({ startSec: 5, endSec: 8.2 });
    expect(checkMontageSegments(g!.segments!, 10)).toBe("");
    g = setMontageAutoMatch(setMontageCrossfade(g, 0.4), true);
    expect(g).toMatchObject({ crossfadeSec: 0.4, autoMatchJunctions: true });
    expect(setMontageCrossfade(g, 0)?.crossfadeSec).toBeUndefined();
    g = removeMontageSegment(g, 0);
    expect(g?.segments?.map(s => [s.startSec, s.endSec])).toEqual([[0, 8.2], [8.2, 10]]);
    g = removeMontageSegment(g, 1);
    expect(g).toBeUndefined();
  });
  it("顾问/调色建议写入分段：同一套校验，只写草稿", () => {
    const next = applyAdvisorMontageFinish({}, { operation: "grade", ...EXPLICIT, grade: { segments: segs, crossfadeSec: 0.5, autoMatchJunctions: true } });
    expect(next.grade?.segments).toEqual(segs);
    expect(() => applyAdvisorMontageFinish({}, { operation: "grade", ...EXPLICIT, grade: { segments: [{ startSec: 0, endSec: 10, lutId: "nope" }] } })).toThrow("调色预设不存在");
    expect(applyMontageSegmentsDraft({ all: { lutId: "basic_warm" } }, [{ startSec: 0, endSec: 4.04 }, { startSec: 4.04, endSec: 10, contrast: 1.2 }], 10)).toEqual({
      all: { lutId: "basic_warm" },
      segments: [{ startSec: 0, endSec: 4 }, { startSec: 4, endSec: 10, contrast: 1.2 }],
    });
    expect(() => applyMontageSegmentsDraft(undefined, [{ startSec: 0, endSec: 8 }], 10)).toThrow("成片结尾");
    expect(() => applyMontageSegmentsDraft({ clips: [null, null] }, segs, 10)).toThrow("不能与逐段调色同时使用");
  });
  it("接点检查结果读取 gradeSegmentCheck：有复检以复检为准并标出自动修正；缺字段返回 null", () => {
    const d = (YAVG: number) => ({ YAVG, UAVG: 0, VAVG: 0, SATAVG: 0 });
    const first = { pass: false, junctions: [{ index: 0, junctionSec: 4, pass: true, delta: d(1) }, { index: 1, junctionSec: 7.5, pass: false, delta: d(9) }] };
    const second = { pass: true, junctions: [{ index: 0, junctionSec: 4, pass: true, delta: d(1) }, { index: 1, junctionSec: 7.5, pass: true, delta: d(2) }] };
    expect(readMontageJunctionCheck({ gradeSegmentCheck: { mode: "junctions", spans: [], check: first } })).toEqual({
      pass: false,
      junctions: [{ atSec: 4, delta: d(1), pass: true, autoCorrected: false }, { atSec: 7.5, delta: d(9), pass: false, autoCorrected: false }],
    });
    expect(readMontageJunctionCheck({ gradeSegmentCheck: { mode: "junctions", spans: [], check: first, autoMatch: { adjusted: [2], spans: [], check: second } } })).toEqual({
      pass: true,
      junctions: [{ atSec: 4, delta: d(1), pass: true, autoCorrected: false }, { atSec: 7.5, delta: d(2), pass: true, autoCorrected: true }],
    });
    expect(readMontageJunctionCheck({ gcsUri: "x" })).toBeNull();
    expect(readMontageJunctionCheck({ gradeSegmentCheck: { check: { junctions: [{ delta: {} }] } } })).toBeNull();
  });
});
