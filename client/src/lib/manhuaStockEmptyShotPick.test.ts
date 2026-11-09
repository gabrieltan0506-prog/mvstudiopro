import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateManhuaStockEmptyShot } from "@shared/manhuaStockFootage";
import { manhuaEmptyShotTrimFromPick } from "./manhuaStockEmptyShotPick";

const asset = (over: Record<string, unknown> = {}) => ({ purpose: "manhua" as const, usage: "empty_shot" as const, kind: "video" as const, durationSec: 12, ...over });

describe("漫剧空镜 · 抽屉裁点", () => {
  it("正向：抽屉裁点原样带入，裁后时长与段长一致时不提示", () => {
    const t = manhuaEmptyShotTrimFromPick({ asset: asset(), inSec: 2.5, outSec: 6.5 }, 4);
    expect(t).toEqual({ inSec: 2.5, outSec: 6.5, spanSec: 4, sourceDurationSec: 12, offPlan: false });
  });
  it("正向：带入的裁点能通过服务端同口径的登记校验", () => {
    const full = { ...asset(), assetId: `sf_${"a".repeat(48)}`, gcsUri: "gs://b/stock-footage/1/a.mp4", source: {} as never };
    const t = manhuaEmptyShotTrimFromPick({ asset: full, inSec: 1, outSec: 5 }, 4);
    expect(validateManhuaStockEmptyShot({ asset: full, inSec: t.inSec, outSec: t.outSec, plannedDurationSec: 4, noPersonConfirmed: true })).toMatchObject({ inSec: 1, outSec: 5 });
  });
  it("反向：出点越过素材时夹回；裁后与段长差超过容差时标出", () => {
    const t = manhuaEmptyShotTrimFromPick({ asset: asset({ durationSec: 5 }), inSec: 3, outSec: 9 }, 6);
    expect(t.outSec).toBe(5);
    expect(t.offPlan).toBe(true);
  });
  it("反向：用途/用法不符、照片、无时长都不进入确认", () => {
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ usage: "reference" }), inSec: 0, outSec: 3 }, 3)).toThrow("漫剧空镜");
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ purpose: "mv", usage: "insert" }), inSec: 0, outSec: 3 }, 3)).toThrow("漫剧空镜");
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ kind: "photo" }), inSec: 0, outSec: 3 }, 3)).toThrow("视频");
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ durationSec: undefined }), inSec: 0, outSec: 3 }, 3)).toThrow("时长");
  });
});

describe("漫剧空镜 / 场景参考 · 登记链不吞错（源码约束）", () => {
  const canvas = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
  const register = readFileSync("client/src/components/manhua/ManhuaStockEmptyShotRegister.tsx", "utf8");
  const workbench = readFileSync("client/src/components/ManhuaScriptWorkbench.tsx", "utf8");
  it("空镜登记：忙碌/未确认剧本/落档失败都向上抛，登记面板据此保留所选并就地显示原因", () => {
    const body = canvas.slice(canvas.indexOf("const handleRegisterStockEmptyShot"), canvas.indexOf("const handleAdoptStockSceneReference"));
    expect(body).toContain('throw new Error("请等待当前生成结束后再登记空镜")');
    expect(body).toContain('throw new Error("请先确认当前剧本，再登记空镜")');
    expect(body).toContain("throw new Error(`空镜未登记：");
    expect(body).not.toContain("toast.error(`空镜未登记");
    expect(body).not.toMatch(/toast\.message\("请等待当前生成结束"\);\s*return;/);
    // 面板：onRegister 抛错 → setError 并保留 picked；只有 resolve 才 setPicked(null)
    expect(register).toMatch(/await props\.onRegister\([\s\S]*?\);\s*setPicked\(null\);\s*\} catch \(e\) \{\s*setError\(/);
  });
  it("场景参考：挂图失败抛给抽屉（抽屉保持打开并提示），只有成功才关抽屉", () => {
    const body = canvas.slice(canvas.indexOf("const handleAdoptStockSceneReference"), canvas.indexOf("const handleSegmentReferenceClear"));
    expect(body).not.toContain("toast.error(");
    expect(body).toContain("buildManhuaSceneReferenceFromStock(asset");
    expect(workbench).toMatch(/await onAdoptStockSceneReference\(asset\);\s*setStockSceneOpen\(false\);/);
  });
});
