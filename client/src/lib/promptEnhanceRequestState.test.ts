/** 待恢复请求编号:sessionStorage 写读清/坏数据折 null/键按用户+block 隔离 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPromptEnhancePendingRequest,
  nextPromptEnhanceRequest,
  promptEnhanceStorageKey,
  readPromptEnhancePendingRequest,
  writePromptEnhancePendingRequest,
} from "./promptEnhanceRequestState";

const values = new Map<string, string>();
const sessionStorageMock: Storage = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key: string) {
    return values.get(key) ?? null;
  },
  key(index: number) {
    return Array.from(values.keys())[index] ?? null;
  },
  removeItem(key: string) {
    values.delete(key);
  },
  setItem(key: string, value: string) {
    values.set(key, String(value));
  },
};

describe("promptEnhanceRequestState", () => {
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("sessionStorage", sessionStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("storage key 必须包含真实 userId(登录后各写各的,不落空键)", () => {
    expect(promptEnhanceStorageKey(42, "b")).toContain("42");
    expect(promptEnhanceStorageKey("42", "b")).toBe("prompt-enhance:42:b");
  });

  it("刷新恢复:localKey 一致复用原编号,绝不生成第二个;内容变了才换新", () => {
    const gen = vi.fn(() => "new-uuid");
    const staged = { requestId: "old-uuid", localKey: "eng\u0000提示词" };
    expect(nextPromptEnhanceRequest(staged, "eng\u0000提示词", gen).requestId).toBe("old-uuid");
    expect(gen).not.toHaveBeenCalled();
    expect(nextPromptEnhanceRequest(staged, "eng\u0000改了", gen).requestId).toBe("new-uuid");
    expect(nextPromptEnhanceRequest(null, "eng\u0000提示词", gen).requestId).toBe("new-uuid");
  });

  it("坏数据(非 JSON/缺字段)折 null,不抛错", () => {
    sessionStorage.setItem(promptEnhanceStorageKey(7, "block-1"), "not-json{");
    expect(readPromptEnhancePendingRequest(7, "block-1")).toBeNull();
    sessionStorage.setItem(promptEnhanceStorageKey(7, "block-1"), JSON.stringify({ requestId: 1 }));
    expect(readPromptEnhancePendingRequest(7, "block-1")).toBeNull();
  });
});
