import { describe, expect, it } from "vitest";
import type { StockFootageAssetView } from "@shared/stockFootage";
import {
  REMIX_STOCK_PICKS_KEY,
  addRemixStockPick,
  parseSegmentDurationSec,
  readRemixStockPicks,
  remixPickFromAsset,
  remixPickSeconds,
  remixSegmentSeconds,
  removeRemixStockPick,
  writeRemixStockPicks,
} from "./remixStockPicks";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const asset = (over: Partial<StockFootageAssetView> = {}): StockFootageAssetView => ({
  assetId: `sf_${"a".repeat(48)}`,
  requestId: "8f0c2a5e-3b1d-4c6e-9a7f-1234567890ab",
  kind: "video",
  purpose: "remix",
  usage: "insert",
  gcsUri: "gs://bucket/stock/sf_a.mp4",
  mimeType: "video/mp4",
  bytes: 1234,
  sha256: "b".repeat(64),
  width: 1080,
  height: 1920,
  durationSec: 12.4,
  source: {
    provider: "pexels",
    providerAssetId: "77",
    pageUrl: "https://example.com/v/77",
    author: { name: "x" },
    license: { name: "l", url: "https://example.com/l" },
    downloadedFrom: "https://videos.example.com/77.mp4",
    providerFileId: "f1",
    retrievedAt: "2026-11-09T00:00:00.000Z",
  },
  context: { segmentId: "2", note: "痛点放大" },
  adoptedAt: "2026-11-09T00:00:00.000Z",
  url: "https://signed.example.com/sf_a.mp4?sig=1",
  ...over,
});

describe("parseSegmentDurationSec", () => {
  it.each([
    ["00:02-00:06", 4],
    ["00:00-00:02", 2],
    ["00:06-00:12", 6],
    ["00:12-00:18", 6],
    ["0:05 – 0:15", 10],
    ["00:00:58-00:01:03", 5],
    ["01:30~02:00", 30],
  ])("%s → %d", (range, expected) => {
    expect(parseSegmentDurationSec(range)).toBe(expected);
  });

  it("解析不了 / 顺序颠倒 / 零长度 → undefined，不冒充目标时长", () => {
    expect(parseSegmentDurationSec("")).toBeUndefined();
    expect(parseSegmentDurationSec("开场钩子")).toBeUndefined();
    expect(parseSegmentDurationSec("00:06-00:02")).toBeUndefined();
    expect(parseSegmentDurationSec("00:02-00:02")).toBeUndefined();
    expect(parseSegmentDurationSec("00:70-00:80")).toBeUndefined();
    expect(parseSegmentDurationSec("2-6")).toBeUndefined();
  });
});

describe("remixPickFromAsset / 秒数", () => {
  it("只存稳定字段（不存签名地址），出点不超过素材时长，入出点一位小数", () => {
    const pick = remixPickFromAsset(asset(), { inSec: 1.26, outSec: 99 }, () => new Date("2026-11-09T01:02:03.000Z"));
    expect(pick).toEqual({
      assetId: `sf_${"a".repeat(48)}`,
      requestId: "8f0c2a5e-3b1d-4c6e-9a7f-1234567890ab",
      kind: "video",
      gcsUri: "gs://bucket/stock/sf_a.mp4",
      width: 1080,
      height: 1920,
      durationSec: 12.4,
      inSec: 1.3,
      outSec: 12.4,
      adoptedAt: "2026-11-09T01:02:03.000Z",
    });
    expect(JSON.stringify(pick)).not.toContain("signed.example.com");
    expect(remixPickSeconds(pick)).toBe(11.1);
    expect(remixSegmentSeconds([pick, { inSec: 0, outSec: 4 }])).toBe(15.1);
    expect(remixSegmentSeconds([])).toBe(0);
  });
});

describe("本机存储按用户分桶", () => {
  const p1 = remixPickFromAsset(asset(), { inSec: 0, outSec: 4 }, () => new Date("2026-11-09T00:00:00.000Z"));
  const p2 = remixPickFromAsset(asset({ assetId: `sf_${"c".repeat(48)}`, requestId: "11111111-2222-4333-8444-555555555555", durationSec: 8 }), { inSec: 2, outSec: 6 }, () => new Date("2026-11-09T00:00:01.000Z"));

  it("写入用户 7 后用户 7 能读到、用户 8 读到空；键名固定", () => {
    const storage = memoryStorage();
    expect(writeRemixStockPicks(storage, 7, { "1": [p1], "3": [p2] })).toBe(true);
    expect(Object.keys(storage.dump())).toEqual([REMIX_STOCK_PICKS_KEY]);
    expect(readRemixStockPicks(storage, 7)).toEqual({ "1": [p1], "3": [p2] });
    expect(readRemixStockPicks(storage, 8)).toEqual({});
    expect(readRemixStockPicks(storage, "7")).toEqual({ "1": [p1], "3": [p2] });
  });

  it("写另一个用户不会覆盖已有用户；清空某用户只删他自己的桶", () => {
    const storage = memoryStorage();
    writeRemixStockPicks(storage, 7, { "1": [p1] });
    writeRemixStockPicks(storage, 8, { "2": [p2] });
    expect(readRemixStockPicks(storage, 7)).toEqual({ "1": [p1] });
    expect(readRemixStockPicks(storage, 8)).toEqual({ "2": [p2] });
    writeRemixStockPicks(storage, 7, {});
    expect(readRemixStockPicks(storage, 7)).toEqual({});
    expect(readRemixStockPicks(storage, 8)).toEqual({ "2": [p2] });
    expect(JSON.parse(storage.dump()[REMIX_STOCK_PICKS_KEY])).toEqual({ version: 1, users: { "8": { "2": [p2] } } });
  });

  it("坏数据：整体不是合法结构 → 空；单条不合格 → 只丢那一条", () => {
    expect(readRemixStockPicks(memoryStorage({ [REMIX_STOCK_PICKS_KEY]: "{not json" }), 7)).toEqual({});
    expect(readRemixStockPicks(memoryStorage({ [REMIX_STOCK_PICKS_KEY]: JSON.stringify({ version: 2, users: {} }) }), 7)).toEqual({});
    const mixed = JSON.stringify({ version: 1, users: { "7": { "1": [p1, { assetId: "bad" }], "2": [{ nope: true }] } } });
    expect(readRemixStockPicks(memoryStorage({ [REMIX_STOCK_PICKS_KEY]: mixed }), 7)).toEqual({ "1": [p1] });
  });

  it("存储不可用时写入返回 false 而不抛", () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => {} };
    expect(writeRemixStockPicks(broken, 7, { "1": [p1] })).toBe(false);
  });

  it("add 同段同素材只留一条并更新入出点；remove 删空后不留空段", () => {
    let picks = addRemixStockPick({}, "2", p1);
    picks = addRemixStockPick(picks, "2", p2);
    picks = addRemixStockPick(picks, "2", { ...p1, inSec: 1, outSec: 3 });
    expect(picks["2"].map(p => [p.assetId, p.inSec, p.outSec])).toEqual([[p2.assetId, 2, 6], [p1.assetId, 1, 3]]);
    picks = removeRemixStockPick(picks, "2", p2.assetId);
    expect(picks).toEqual({ "2": [{ ...p1, inSec: 1, outSec: 3 }] });
    picks = removeRemixStockPick(picks, "2", p1.assetId);
    expect(picks).toEqual({});
    expect(removeRemixStockPick(picks, "9", "nope")).toEqual({});
  });
});
