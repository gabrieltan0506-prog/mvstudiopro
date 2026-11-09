import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_GRADE_LUT_ID_RE, concatGradeSchema } from "@shared/colorGrade";
import {
  MONTAGE_LUT_GROUPS,
  MONTAGE_LUT_IDS,
  MONTAGE_TRANSITION_RANGE,
  montageFinishParams,
  montageTransitionBlockReason,
  normalizeMontageGrade,
  normalizeMontageTransition,
  patchMontageGradeAll,
  readMontageFinish,
  type MontageFinish,
} from "./montageFinish";

type ManifestEntry = { id: string; intensity: "subtle" | "standard"; labelZh: string };
const manifest = JSON.parse(readFileSync("server/assets/luts/manifest.json", "utf8")) as ManifestEntry[];

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
