import { describe, expect, it } from "vitest";
import {
  buildFilterChain, checkGradeConsistency, colorCorrectionSchema, computeZoneDistribution, concatGradeSchema,
  deriveMatchingCorrections, matchShotsToReference, parseSignalStats, resolveClipCorrection, collectGradeLutIds,
  type SignalStats,
} from "./colorGrade";

const stats = (o: Partial<SignalStats>): SignalStats => ({
  YMIN: 16, YLOW: 40, YAVG: 110, YHIGH: 200, YMAX: 235, UMIN: 100, UAVG: 128, UMAX: 150,
  VMIN: 100, VAVG: 128, VMAX: 150, SATMIN: 0, SATAVG: 50, SATMAX: 100, HUEMED: 0, HUEAVG: 0, ...o,
});

describe("buildFilterChain（上游顺序）", () => {
  it("空参数为空串", () => expect(buildFilterChain({})).toBe(""));
  it("各参数生成的滤镜串", () => {
    expect(buildFilterChain({ exposure: 1 })).toBe("curves=master='0/0 0.25/0.5 1/1'");
    expect(buildFilterChain({ gamma: 1.2 })).toBe("eq=gamma=1.2");
    expect(buildFilterChain({ gamma_r: 1.1 })).toBe(`lutyuv=y=gammaval(${1 / ((1.1 + 1 + 1) / 3)}),colorbalance=rs=${1.1 - 1}:gs=0:bs=0:rm=${1.1 - 1}:gm=0:bm=0:rh=${1.1 - 1}:gh=0:bh=0`);
    expect(buildFilterChain({ gamma_r: 1, gamma_g: 1, gamma_b: 1 })).toBe("lutyuv=y=gammaval(1)");
    expect(buildFilterChain({ contrast: 1.1 })).toBe("eq=contrast=1.1");
    expect(buildFilterChain({ color_temperature: 5600 })).toBe("colortemperature=temperature=5600");
    expect(buildFilterChain({ color_balance: { shadows: { r: 0.1, g: 0, b: -0.1 }, highlights: { r: 0, g: 0.05, b: 0 } } }))
      .toBe("colorbalance=rs=0.1:gs=0:bs=-0.1:rh=0:gh=0.05:bh=0");
    expect(buildFilterChain({ curves: { master: "0/0 0.5/0.6 1/1", b: "0/0.05 1/0.95" } }))
      .toBe("curves=master='0/0 0.5/0.6 1/1':blue='0/0.05 1/0.95'");
    expect(buildFilterChain({ saturation: 1.2 })).toBe("eq=saturation=1.2");
  });
  it("全参数顺序：LUT→曝光→gamma→对比→色温→三段→曲线→饱和度", () => {
    const chain = buildFilterChain({
      saturation: 1.1, curves: { master: "0/0 1/1" }, color_balance: { midtones: { r: 0.1, g: 0, b: 0 } },
      color_temperature: 6000, contrast: 1.05, gamma: 0.9, exposure: 0.5, lutId: "teal_orange",
    }, id => `/srv/luts/${id}.cube`);
    expect(chain.split(",").map(f => f.split("=")[0])).toEqual(["lut3d", "curves", "eq", "eq", "colortemperature", "colorbalance", "curves", "eq"]);
    expect(chain.startsWith("lut3d='/srv/luts/teal_orange.cube'")).toBe(true);
  });
  it("有 lutId 但无解析器时拒绝", () => expect(() => buildFilterChain({ lutId: "x" })).toThrow("调色预设"));
});

describe("参数边界与白名单形状", () => {
  it("lutId 不收路径/注入", () => {
    for (const bad of ["../x", "/etc/a.cube", "a,b", "A'", "x;y", ""]) expect(colorCorrectionSchema.safeParse({ lutId: bad }).success).toBe(false);
    expect(colorCorrectionSchema.safeParse({ lutId: "nordic_desaturation_subtle" }).success).toBe(true);
  });
  it("curves 只收点串；custom_filter 不开放", () => {
    expect(colorCorrectionSchema.safeParse({ curves: { master: "0/0 1/1':lut3d=x" } }).success).toBe(false);
    expect(colorCorrectionSchema.safeParse({ custom_filter: "drawtext" }).success).toBe(false);
    expect(colorCorrectionSchema.safeParse({ exposure: -1 }).success).toBe(false);
  });
  it("all 与 clips 浅合并；lutId 去重", () => {
    const g = concatGradeSchema.parse({ all: { saturation: 1.1, lutId: "a" }, clips: [null, { saturation: 0.9 }] });
    expect(resolveClipCorrection(g, 0)).toEqual({ saturation: 1.1, lutId: "a" });
    expect(resolveClipCorrection(g, 1)).toEqual({ saturation: 0.9, lutId: "a" });
    expect(resolveClipCorrection(undefined, 0)).toBeNull();
    expect(resolveClipCorrection(concatGradeSchema.parse({}), 0)).toBeNull();
    expect(collectGradeLutIds(concatGradeSchema.parse({ all: { lutId: "a" }, clips: [{ lutId: "a" }, { lutId: "b" }] }))).toEqual(["a", "b"]);
  });
});

describe("analyze：signalstats 解析与分区", () => {
  it("解析 metadata=mode=print 输出", () => {
    const raw = "[Parsed_metadata_1 @ 0x1] frame:0 pts:0\n[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG=81.5\n[Parsed_metadata_1 @ 0x1] lavfi.signalstats.UAVG=131.25\nlavfi.signalstats.VAVG=120\nlavfi.signalstats.SATAVG=33.7\n";
    const s = parseSignalStats(raw);
    expect([s.YAVG, s.UAVG, s.VAVG, s.SATAVG, s.YMAX]).toEqual([81.5, 131.25, 120, 33.7, 0]);
  });
  it("分区估计同上游公式", () => {
    const z = computeZoneDistribution(stats({ YMIN: 10, YLOW: 50, YHIGH: 200, YMAX: 250 }));
    expect(z.blacks).toBe(11);
    expect(z.whites).toBeCloseTo(5 + 10 / 3);
    expect(z.midtones).toBeCloseTo((150 / 240) * 100 * 0.6);
  });
});

describe("镜头匹配与一致性", () => {
  it("deriveMatchingCorrections 照上游：曝光 yDelta/40、色温 uDelta*60、midtones vShift、饱和度 0.7 混合", () => {
    const ref = stats({ YAVG: 120, UAVG: 125, VAVG: 133, SATAVG: 60 });
    const tgt = stats({ YAVG: 100, UAVG: 130, VAVG: 128, SATAVG: 40 });
    const c = deriveMatchingCorrections(ref, tgt, ["all"], {});
    expect(c.exposure).toBe(0.5);
    expect(c.color_temperature).toBe(6500 - 300);
    expect(c.color_balance?.midtones).toEqual({ r: parseFloat(((5 / 255) * 0.5).toFixed(3)), g: parseFloat((-(5 / 255) * 0.25).toFixed(3)), b: parseFloat((-(5 / 255) * 0.25).toFixed(3)) });
    expect(c.saturation).toBe(parseFloat((1 + (60 / 40 - 1) * 0.7).toFixed(3)));
    expect(deriveMatchingCorrections(ref, stats({ YAVG: 118 }), ["exposure"], {})).toEqual({});
  });
  it("matchShotsToReference：代表镜头保留原参，其余可直接作 grade.clips", () => {
    const out = matchShotsToReference({ stats: [stats({ YAVG: 120 }), stats({ YAVG: 100 }), stats({ YAVG: 121 })], referenceClipIndex: 0, existing: [{ lutId: "a" }] });
    expect(out).toEqual([{ lutId: "a" }, { exposure: 0.5 }, null]);
    expect(concatGradeSchema.safeParse({ clips: out, referenceClipIndex: 0 }).success).toBe(true);
    expect(matchShotsToReference({ stats: [stats({ YAVG: 230 }), stats({ YAVG: 20 })], referenceClipIndex: 0 })[1]?.exposure).toBe(3);
  });
  it("checkGradeConsistency：YAVG ±5、UAVG/VAVG ±3、SATAVG ±5", () => {
    const ref = stats({});
    const r = checkGradeConsistency([ref, stats({ YAVG: 115, UAVG: 131, VAVG: 125, SATAVG: 55 }), stats({ UAVG: 131.5 })], 0);
    expect(r.clips.map(c => c.pass)).toEqual([true, true, false]);
    expect(r.pass).toBe(false);
    expect(r.clips[2].delta.UAVG).toBe(3.5);
    expect(() => checkGradeConsistency([ref], 3)).toThrow();
  });
});
