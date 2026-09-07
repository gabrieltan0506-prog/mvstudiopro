import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { prepareManhuaBackupRestore } from "./manhuaBackupRestorePreflight";

const blockedMessage =
  "备份文件内容无法安全恢复，尚未写入图片或替换工作区，请保留原文件";
const network = vi.fn(() => {
  throw new Error("预检不得联网");
});
const store = vi.fn(() => {
  throw new Error("预检不得写入浏览器存储");
});

beforeEach(() => {
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("indexedDB", { open: store });
  vi.stubGlobal("localStorage", {
    getItem: store,
    setItem: store,
    removeItem: store,
  });
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function minimal() {
  return { writerSession: {}, canvas: { blocks: [] as unknown[], edges: [] } };
}

function freezeDeep(value: unknown) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
}

describe("备份恢复真实消费者纯预检", () => {
  it.each(["writerSession", "factoryPrefs"])(
    "%s 超过既有48张容量时不静默截断",
    container => {
      const refs = Array.from({ length: 49 }, (_, i) => ({
        id: `asset-${i}`,
        url: `https://test.invalid/asset-${i}.png`,
        role: "character",
      }));
      const raw = { ...minimal(), [container]: { customAssetRefs: refs } };
      expect(() => prepareManhuaBackupRestore(raw)).toThrow(
        "超过当前 48 张容量"
      );
      expect(raw[container as keyof typeof raw]).toEqual({
        customAssetRefs: refs,
      });
    }
  );
  it.each([
    null,
    { canvas: { blocks: [] } },
    { writerSession: [], canvas: { blocks: [] } },
    { writerSession: {}, canvas: { blocks: [null] } },
    { writerSession: {}, canvas: { blocks: [], edges: "broken" } },
    { writerSession: {}, canvas: { blocks: [], edges: [null] } },
  ])("最低结构错误在写入之前统一拒绝：%j", raw => {
    expect(() => prepareManhuaBackupRestore(raw)).toThrow(blockedMessage);
  });

  it.each(["outputUrls", "editFusionUrls"])(
    "实际节点转换拒绝错误 %s 类型",
    field => {
      const raw = minimal();
      raw.canvas.blocks.push({
        id: "bad-node",
        kind: "image",
        [field]: "not-an-array",
      });
      expect(() => prepareManhuaBackupRestore(raw)).toThrow(blockedMessage);
    }
  );

  it.each([
    { characters: "not-an-array" },
    { characters: [null] },
    { characters: [], locations: "not-an-array" },
    { characters: [], locations: [null] },
  ])("实际 canon 纠偏和指纹消费者拒绝坏内容：%j", assetCanon => {
    const raw = {
      ...minimal(),
      writerSession: { projectBible: { assetCanon } },
    };
    expect(() => prepareManhuaBackupRestore(raw)).toThrow(blockedMessage);
  });

  it.each([
    "propIds",
    "characterIds",
    "ancientArchetypeIds",
    "wardrobePropContinuityIds",
  ])("页面直接消费的 cast.%s 不能是字符串或空条目", field => {
    for (const value of ["not-an-array", [null]]) {
      const raw = {
        ...minimal(),
        writerSession: { projectBible: { cast: { [field]: value } } },
      };
      expect(() => prepareManhuaBackupRestore(raw)).toThrow(blockedMessage);
    }
  });

  it("旧稿只补缺失 edges，不变动源对象或额外字段", () => {
    const raw = {
      writerSession: {},
      canvas: { blocks: [], oldCanvasExtra: "keep" },
      oldExtra: [1, 2],
    };
    freezeDeep(raw);
    expect(prepareManhuaBackupRestore(raw)).toEqual({
      ...raw,
      canvas: { ...raw.canvas, edges: [] },
    });
    expect(raw.canvas).not.toHaveProperty("edges");
  });

  it("真实快照保留全部候选、长历史、旧字段及未识别字段，不返回转换后的截断稿", () => {
    const history = Array.from(
      { length: 25 },
      (_, i) => `https://test.invalid/image-${i}.png`
    );
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {
        customAssetRefs: history.map((url, i) => ({
          id: `candidate-${i}`,
          url,
          role: "character" as const,
        })),
      },
      blocks: [
        {
          id: "keyart-e01-s01",
          kind: "image",
          x: 0,
          y: 0,
          width: 160,
          height: 200,
          prompt: "保留历史",
          outputUrls: history,
        },
      ],
      edges: [],
      factoryPrefs: { directorBoardMainByEpisode: { 1: { url: history[0] } } },
    });
    const raw = {
      ...payload,
      unrecognizedReceipt: { raw: "do-not-strip", entries: history },
      canvas: {
        ...payload.canvas,
        blocks: payload.canvas.blocks.map(block => ({
          ...block,
          editFusionUrls: history,
          legacyField: { retained: true },
        })),
      },
    };
    const before = JSON.stringify(raw);
    freezeDeep(raw);
    const result = prepareManhuaBackupRestore(raw);
    expect(result).toBe(raw);
    expect(JSON.stringify(result)).toBe(before);
    expect(result.canvas.blocks[0]!.outputUrls).toHaveLength(25);
    expect(result.canvas.blocks[0]!.editFusionUrls).toHaveLength(25);
    expect(result.writerSession.customAssetRefs).toHaveLength(25);
  });
});
