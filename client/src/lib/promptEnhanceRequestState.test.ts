/** 待恢复请求编号:sessionStorage 写读清/坏数据折 null/键按用户+block 隔离 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPromptEnhancePendingRequest,
  promptEnhanceStorageKey,
  readPromptEnhancePendingRequest,
  writePromptEnhancePendingRequest,
} from "./promptEnhanceRequestState";

describe("promptEnhanceRequestState", () => {
  beforeEach(() => sessionStorage.clear());

  it("写入后可读回;刷新场景=只剩 sessionStorage 也能恢复", () => {
    writePromptEnhancePendingRequest(7, "block-1", {
      requestId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      localKey: "seedance-2.5\0雨夜巷战",
    });
    expect(readPromptEnhancePendingRequest(7, "block-1")).toEqual({
      requestId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      localKey: "seedance-2.5\0雨夜巷战",
    });
  });

  it("键按用户与 block 隔离,互不串号", () => {
    writePromptEnhancePendingRequest(7, "block-1", { requestId: "a", localKey: "k" });
    expect(readPromptEnhancePendingRequest(8, "block-1")).toBeNull();
    expect(readPromptEnhancePendingRequest(7, "block-2")).toBeNull();
    expect(promptEnhanceStorageKey(7, "block-1")).toBe("prompt-enhance:7:block-1");
  });

  it("明确终态后清除,再读为 null(新操作生成新编号)", () => {
    writePromptEnhancePendingRequest("7", "block-1", { requestId: "a", localKey: "k" });
    clearPromptEnhancePendingRequest("7", "block-1");
    expect(readPromptEnhancePendingRequest("7", "block-1")).toBeNull();
  });

  it("坏数据(非 JSON/缺字段)折 null,不抛错", () => {
    sessionStorage.setItem(promptEnhanceStorageKey(7, "block-1"), "not-json{");
    expect(readPromptEnhancePendingRequest(7, "block-1")).toBeNull();
    sessionStorage.setItem(promptEnhanceStorageKey(7, "block-1"), JSON.stringify({ requestId: 1 }));
    expect(readPromptEnhancePendingRequest(7, "block-1")).toBeNull();
  });
});
