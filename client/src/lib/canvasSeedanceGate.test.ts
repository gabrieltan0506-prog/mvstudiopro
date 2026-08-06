import { describe, expect, it } from "vitest";
import { SEEDANCE_25_LAUNCH_AT_MS } from "@shared/seedance25Access";
import {
  downgradeUnauthorizedSeedance25Blocks,
  filterCanvasVideoModelOptions,
  resolveCanvasSeedance25Gate,
} from "./canvasSeedanceGate";
import { defaultCanvasBlock, VIDEO_MODEL_OPTIONS } from "./canvasTypes";

const BEFORE = SEEDANCE_25_LAUNCH_AT_MS - 60_000;
const AFTER = SEEDANCE_25_LAUNCH_AT_MS + 60_000;

/**
 * 前端闸门必须与服务端 `assertSeedance25PaidAccess`（shared/seedance25Access.test.ts）
 * 同一份判定矩阵，覆盖 P0 验收的四种组合：未到点 pro 看不到、未到点 supervisor 看得到、
 * 到点 pro 看得到、到点 free 看不到并给邀请码文案。
 */
describe("resolveCanvasSeedance25Gate · 四种组合", () => {
  it("未到点 + pro：不放开", () => {
    const gate = resolveCanvasSeedance25Gate({ plan: "pro", role: "user", now: BEFORE });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("before_launch");
  });

  it("未到点 + supervisor/admin：放开", () => {
    expect(
      resolveCanvasSeedance25Gate({ plan: "free", role: "supervisor", now: BEFORE }).allowed,
    ).toBe(true);
    expect(
      resolveCanvasSeedance25Gate({ plan: "free", role: "admin", now: BEFORE }).allowed,
    ).toBe(true);
  });

  it("到点 + pro：放开", () => {
    const gate = resolveCanvasSeedance25Gate({ plan: "pro", role: "user", now: AFTER });
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeNull();
  });

  it("到点 + free（邀请码充值）：不放开，给正式会员文案", () => {
    const gate = resolveCanvasSeedance25Gate({ plan: "free", role: "user", now: AFTER });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("paid_only");
    expect(gate.message).toContain("正式会员");
  });
});

describe("filterCanvasVideoModelOptions", () => {
  it("无权限时从下拉里过滤掉成片·加长", () => {
    const filtered = filterCanvasVideoModelOptions(false, VIDEO_MODEL_OPTIONS);
    expect(filtered.some((m) => m.id === "seedance-2.5")).toBe(false);
    expect(filtered.length).toBe(VIDEO_MODEL_OPTIONS.length - 1);
  });

  it("有权限时保留全部选项", () => {
    const filtered = filterCanvasVideoModelOptions(true, VIDEO_MODEL_OPTIONS);
    expect(filtered).toEqual(VIDEO_MODEL_OPTIONS);
  });
});

describe("downgradeUnauthorizedSeedance25Blocks", () => {
  it("无权限且草稿里有残留加长档时降回快速", () => {
    const block = defaultCanvasBlock("video", 0, 0);
    block.videoModel = "seedance-2.5";
    const next = downgradeUnauthorizedSeedance25Blocks([block], false);
    expect(next).not.toBeNull();
    expect(next?.[0]?.videoModel).toBe("seedance-2.0-fast");
  });

  it("有权限时不改动草稿（返回 null）", () => {
    const block = defaultCanvasBlock("video", 0, 0);
    block.videoModel = "seedance-2.5";
    expect(downgradeUnauthorizedSeedance25Blocks([block], true)).toBeNull();
  });

  it("无权限但草稿里没有加长档时返回 null（不触发多余更新）", () => {
    const block = defaultCanvasBlock("video", 0, 0);
    block.videoModel = "seedance-2.0-fast";
    expect(downgradeUnauthorizedSeedance25Blocks([block], false)).toBeNull();
  });
});
