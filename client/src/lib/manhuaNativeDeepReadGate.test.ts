import { describe, expect, it } from "vitest";
import { resolveManhuaNativeDeepReadGate } from "./manhuaNativeDeepReadGate";

describe("resolveManhuaNativeDeepReadGate", () => {
  it("只有非候选素材允许进入旧链", () => {
    expect(resolveManhuaNativeDeepReadGate({
      candidate: false,
      capabilityLoading: false,
      capabilityError: false,
      ownerAllowed: false,
    })).toBe("legacy");
  });

  it("权限仍在读取或读取失败时关闭式停止", () => {
    expect(resolveManhuaNativeDeepReadGate({
      candidate: true,
      capabilityLoading: true,
      capabilityError: false,
      ownerAllowed: false,
    })).toBe("blocked_unconfirmed");
    expect(resolveManhuaNativeDeepReadGate({
      candidate: true,
      capabilityLoading: false,
      capabilityError: true,
      ownerAllowed: false,
    })).toBe("blocked_unconfirmed");
  });

  it("候选素材不属于 owner 时不回落旧链", () => {
    expect(resolveManhuaNativeDeepReadGate({
      candidate: true,
      capabilityLoading: false,
      capabilityError: false,
      ownerAllowed: false,
    })).toBe("blocked_not_owner");
  });

  it("只有 owner 且权限已确认时进入计划预览", () => {
    expect(resolveManhuaNativeDeepReadGate({
      candidate: true,
      capabilityLoading: false,
      capabilityError: false,
      ownerAllowed: true,
    })).toBe("ready");
  });
});
