import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canUseAdvisorPrevisFor, mvShotPrevisBridgeUnavailableZh } from "./mvShotPrevisAccess";

const mvClip = { musicMvShot: { shotId: "s3" } };
const manhuaClip = {};

describe("1110 MV 镜头白模入口对普通登录用户开放；其他 3D 门槛不变", () => {
  it("普通登录用户：MV 镜头块可用，桥无不可用原因", () => {
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: false, userId: 7, clip: mvClip })).toBe(true);
    expect(mvShotPrevisBridgeUnavailableZh({ userId: 7 })).toBeUndefined();
  });
  it("普通用户的漫剧片段白模仍不可用；管理员/监督照旧", () => {
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: false, userId: 7, clip: manhuaClip })).toBe(false);
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: false, userId: 7, clip: undefined })).toBe(false);
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: true, userId: 1, clip: manhuaClip })).toBe(true);
  });
  it("未登录或制作中不可用", () => {
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: false, userId: undefined, clip: mvClip })).toBe(false);
    expect(mvShotPrevisBridgeUnavailableZh({ userId: null })).toMatch(/登录/);
    expect(mvShotPrevisBridgeUnavailableZh({ userId: 7, factoryBusy: true })).toMatch(/制作中/);
  });
  it("页面接线：MV 白模桥不再看 canUseManhua3d；3D/3DGS/绑骨入口仍按 canUseManhua3d", () => {
    const src = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
    expect(src).toContain('const canUseManhua3d = user?.role === "admin" || user?.role === "supervisor";');
    const bridge = src.slice(src.indexOf("const mvPrevisBridge"), src.indexOf("} : undefined;", src.indexOf("const mvPrevisBridge")));
    expect(bridge).toContain("mvShotPrevisBridgeUnavailableZh");
    expect(bridge).not.toContain("canUseManhua3d");
    const open = src.slice(src.indexOf("function openMvShotAdvisorPrevis"), src.indexOf("const mvPrevisBridge"));
    expect(open).not.toContain("canUseManhua3d");
    for (const gated of ["onGenerateAsset3d={canUseManhua3d ?", "onGenerateSceneWorld={canUseManhua3d ?", "onApplyRiggedModel={canUseManhua3d ?", "onOpenAdvisorPrevis={canUseManhua3d ?", "onUpdateClipPrevisStudio={canUseManhua3d ?"]) expect(src).toContain(gated);
    expect(src.match(/canUseAdvisorPrevisFor\(/g)?.length).toBe(4);
  });
  it("顾问白模页音轨控件：MV 镜头块对普通登录用户可用，漫剧片段仍按 canUseManhua3d", () => {
    const src = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
    const audio = src.slice(src.indexOf("<ManhuaPrevisAudioControls compact"), src.indexOf("onChange=", src.indexOf("<ManhuaPrevisAudioControls compact")));
    expect(audio).toContain("disabled={!canUseAdvisorPrevisFor({ canUseManhua3d, userId: user?.id, clip: advisorPrevisClip })");
    expect(audio).not.toMatch(/disabled=\{!canUseManhua3d\b/);
    // 同一判定：普通用户 MV 镜头可用、漫剧片段不可用
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: false, userId: 7, clip: mvClip })).toBe(true);
    expect(canUseAdvisorPrevisFor({ canUseManhua3d: false, userId: 7, clip: manhuaClip })).toBe(false);
  });
});
