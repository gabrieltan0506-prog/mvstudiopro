import { describe, expect, it } from "vitest";
import {
  digitalHumanOverlayDraftSchema, digitalHumanOverlayFilter, digitalHumanOverlayIssues, digitalHumanOverlayRequest,
  digitalHumanOverlaySchema, placeDigitalHumanOverlay, DIGITAL_HUMAN_PHOTO_OVERLAY_SEC,
} from "./digitalHumanOverlay";
import { digitalHumanFinalParamsSchema } from "./digitalHumanProduction";
import { digitalHumanDraftSchema, newDigitalHumanDraft } from "./digitalHumanStudio";

const id = "00000000-0000-4000-8000-000000000001";
const A = `sf_${"a".repeat(48)}`, B = `sf_${"b".repeat(48)}`;
const facts = (map: Record<string, { kind: "video" | "photo"; durationSec?: number }>) => (assetId: string) => map[assetId];
const ov = (assetId: string, startSec: number, durationSec: number, sourceInSec = 0) => ({ assetId, startSec, durationSec, sourceInSec, mode: "overlay" as const });
const final = { audioUri: "gs://test/voice.wav", audioRequestId: id, clips: [{ videoUri: "gs://test/v.mp4", startSec: 0, endSec: 10 }], voice: { pan: 0, room: "dry", volume: 1 }, tracks: [], aspectRatio: "9:16" };

describe("数字人补充画面覆盖轨校验", () => {
  it("正向：口播内、互不重叠、视频选段不超素材、照片固定展示时长", () => {
    const rows = [ov(A, 0, 3, 2), ov(B, 5, 3)];
    expect(digitalHumanOverlayIssues(rows, 10, facts({ [A]: { kind: "video", durationSec: 5 }, [B]: { kind: "photo" } }))).toEqual([]);
    // 首尾相接不算重叠
    expect(digitalHumanOverlayIssues([ov(A, 0, 3), ov(A, 3, 2)], 10, facts({ [A]: { kind: "video", durationSec: 5 } }))).toEqual([]);
  });
  it("反向：超出口播总时长、重叠、视频选段超长、照片带入点或时长越界、未采用素材", () => {
    const v = facts({ [A]: { kind: "video", durationSec: 5 }, [B]: { kind: "photo" } });
    expect(digitalHumanOverlayIssues([ov(A, 8, 3)], 10, v)[0].message).toContain("超出口播总时长");
    expect(digitalHumanOverlayIssues([ov(A, 0, 3), ov(A, 2, 2)], 10, v).map(i => i.message).join()).toContain("重叠");
    expect(digitalHumanOverlayIssues([ov(A, 0, 3, 3)], 10, v)[0].message).toContain("超过素材时长");
    expect(digitalHumanOverlayIssues([ov(B, 0, 3, 1)], 10, v)[0].message).toContain("入点须为0");
    expect(digitalHumanOverlayIssues([ov(B, 0, 12)], 20, v)[0].message).toContain("展示时长");
    expect(digitalHumanOverlayIssues([ov(`sf_${"c".repeat(48)}`, 0, 2)], 10, v)[0].message).toContain("未采用");
    expect(digitalHumanOverlayIssues([ov(A, 0, 2)], 0)[0].message).toContain("口播总时长");
    expect(digitalHumanOverlayIssues([ov(A, 0, 2)], 10, facts({ [A]: { kind: "video" } }))[0].message).toContain("缺少时长");
  });
  it("提交形状只有 assetId+时间，拒绝夹带地址；草稿行转提交时丢弃展示字段，overlay 不带回切备注", () => {
    expect(digitalHumanOverlaySchema.safeParse({ ...ov(A, 0, 2), gcsUri: "gs://x/y" }).success).toBe(false);
    expect(digitalHumanOverlaySchema.safeParse(ov("sf_bad", 0, 2)).success).toBe(false);
    const row = digitalHumanOverlayDraftSchema.parse({ ...ov(A, 1, 2), returnNote: "回到人物", kind: "video", sourceDurationSec: 5, width: 1920, height: 1080, attribution: "Someone / Pexels" });
    expect(digitalHumanOverlayRequest(row)).toEqual(ov(A, 1, 2));
    expect(digitalHumanOverlayRequest({ ...row, mode: "cutaway" })).toEqual({ ...ov(A, 1, 2), mode: "cutaway", returnNote: "回到人物" });
  });
});

describe("最终合成参数中的覆盖轨", () => {
  it("正向：旧任务无 overlays 照常通过，合法覆盖轨通过且不改人物 clips 连续性要求", () => {
    expect(digitalHumanFinalParamsSchema.safeParse(final).success).toBe(true);
    expect(digitalHumanFinalParamsSchema.parse(final)).not.toHaveProperty("overlays");
    expect(digitalHumanFinalParamsSchema.safeParse({ ...final, overlays: [ov(A, 2, 3), { ...ov(B, 6, 4), mode: "cutaway", returnNote: "回切" }] }).success).toBe(true);
  });
  it("反向：覆盖越过成片尾、互相重叠、空数组都拒绝", () => {
    expect(digitalHumanFinalParamsSchema.safeParse({ ...final, overlays: [ov(A, 8, 3)] }).success).toBe(false);
    expect(digitalHumanFinalParamsSchema.safeParse({ ...final, overlays: [ov(A, 0, 3), ov(B, 2, 3)] }).success).toBe(false);
    expect(digitalHumanFinalParamsSchema.safeParse({ ...final, overlays: [] }).success).toBe(false);
  });
});

describe("放置与草稿恢复", () => {
  it("正向：照片给固定展示时长；视频从首个空档开始；优先放在指定起点", () => {
    expect(placeDigitalHumanOverlay([], { kind: "photo" }, 10)).toEqual({ startSec: 0, durationSec: DIGITAL_HUMAN_PHOTO_OVERLAY_SEC, sourceInSec: 0 });
    expect(placeDigitalHumanOverlay([{ startSec: 0, durationSec: 3 }], { kind: "video", durationSec: 2.5 }, 10)).toEqual({ startSec: 3, durationSec: 2.5, sourceInSec: 0 });
    expect(placeDigitalHumanOverlay([{ startSec: 0, durationSec: 3 }], { kind: "video", durationSec: 20 }, 10, 6)).toEqual({ startSec: 6, durationSec: 4, sourceInSec: 0 });
    // 尾部空档不足默认时长时截短到口播结束
    expect(placeDigitalHumanOverlay([], { kind: "video", durationSec: 20 }, 10, 8)).toEqual({ startSec: 8, durationSec: 2, sourceInSec: 0 });
  });
  it("反向：无批准配音、时间轴已满、视频无时长时拒绝放置", () => {
    expect(() => placeDigitalHumanOverlay([], { kind: "photo" }, 0)).toThrow("批准完整配音");
    expect(() => placeDigitalHumanOverlay([{ startSec: 0, durationSec: 10 }], { kind: "photo" }, 10)).toThrow("空档");
    expect(() => placeDigitalHumanOverlay([], { kind: "video" }, 10)).toThrow("缺少时长");
  });
  it("覆盖轨随制作稿保存与恢复；旧稿缺省为空且不影响音轨", () => {
    const d = newDigitalHumanDraft("7", id);
    const row = { ...ov(A, 1, 2), kind: "photo" as const, width: 800, height: 600, attribution: "Someone / Pexels", pageUrl: "https://www.pexels.com/photo/1/" };
    const restored = digitalHumanDraftSchema.parse(JSON.parse(JSON.stringify({ ...d, mix: { ...d.mix, overlays: [row] } })));
    expect(restored.mix.overlays).toEqual([row]);
    const legacy = JSON.parse(JSON.stringify(d)); delete legacy.mix.overlays;
    expect(digitalHumanDraftSchema.parse(legacy).mix).toEqual({ voice: { pan: 0, room: "dry", volume: 1 }, tracks: [], overlays: [] });
  });
});

describe("覆盖层滤镜", () => {
  it("正向：缩放补边到成片画幅、按起点延时叠加、只出视频", () => {
    const f = digitalHumanOverlayFilter([{ startSec: 1.5, durationSec: 2 }, { startSec: 5, durationSec: 3 }], 1080, 1920);
    expect(f).toContain("[1:v]trim=duration=2.000");
    expect(f).toContain("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920");
    expect(f).toContain("setpts=PTS+1.500/TB[ov0]");
    expect(f).toContain("[0:v][ov0]overlay=x=0:y=0:eof_action=pass:repeatlast=0:enable='between(t,1.500,3.500)'[base0]");
    expect(f).toContain("[base0][ov1]overlay=");
    expect(f.endsWith("[vout]")).toBe(true);
    expect(f).not.toMatch(/:a\]/);
  });
  it("反向：空列表或非有限数值拒绝生成", () => {
    expect(() => digitalHumanOverlayFilter([], 1080, 1920)).toThrow();
    expect(() => digitalHumanOverlayFilter([{ startSec: Number.NaN, durationSec: 1 }], 1080, 1920)).toThrow("无效");
  });
});
