import { describe, expect, it } from "vitest";
import {
  hasSupervisorRole,
  isInternalGoogleMediaOp,
  isRetiredGoogleVideoOp,
  isSupervisorWorkflowOp,
} from "./internalMediaEndpointPolicy";

describe("内部媒体端点 fail-closed 策略", () => {
  it("Veo/Nano/Omni 同步入口只允许监管角色", () => {
    expect(isInternalGoogleMediaOp("nanoImage")).toBe(true);
    expect(hasSupervisorRole("admin")).toBe(true);
    expect(hasSupervisorRole("supervisor")).toBe(true);
    expect(hasSupervisorRole("user")).toBe(false);
  });

  it("Veo 与 Google Omni 的创建、轮询、素材和 Interaction 入口全部淘汰", () => {
    for (const op of [
      "veoCreate",
      "veoTask",
      "omniVideoCreate",
      "omniVideoTask",
      "omniMaterialUrl",
      "omniInteractionCreate",
      "omniInteractionGet",
      "translateForVeo",
    ]) {
      expect(isRetiredGoogleVideoOp(op)).toBe(true);
      expect(isInternalGoogleMediaOp(op)).toBe(false);
    }
  });

  it("workflowTest/status/poll/save 与未来 workflow 动作都不会漏过闸门", () => {
    for (const op of [
      "workflowTest",
      "workflowStatus",
      "workflowGenerateSceneVideo",
      "workflowVeoPoll",
      "workflowFuturePaidAction",
      "startWorkflow",
    ]) {
      expect(isSupervisorWorkflowOp(op)).toBe(true);
    }
    expect(isSupervisorWorkflowOp("seedanceI2V")).toBe(false);
  });
});
