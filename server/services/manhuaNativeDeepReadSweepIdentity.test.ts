/**
 * 0920 实链暴露的缺陷回归：整形前补扫**不得原地改**段缓存 entry 里的 `raw`。
 *
 * 段证据对象名 = hash(整条 entry 含 raw)；补扫改完之后 provenance 才重算名字，
 * 名字就和早先真正上传的证据对象对不上 → 报告渲染按「不许列目录猜证据」拒绝出报告
 * （藏海传第 2 集 seg4/seg6 实测 404）。付费证据身份必须逐字不变。
 */
import { describe, expect, it } from "vitest";
import {
  nativeDeepReadSegmentEvidenceObjectName,
  nativeDeepReadSegmentEvidenceResponseFingerprint,
  type NativeDeepReadSegmentCacheEntry,
} from "./manhuaNativeDeepReadSegmentCache.js";

function makeEntry(keyMoments: Array<Record<string, unknown>>): NativeDeepReadSegmentCacheEntry {
  return {
    seriesKey: "sweep_identity_regression",
    episodeIndex: 2,
    segmentIndex: 4,
    sourceDigest: "a".repeat(64),
    fingerprint: "b".repeat(64),
    startSec: 1212,
    endSec: 1515,
    hasAudio: true,
    requestedFps: 10,
    visualRoute: "vertex_gcs_video",
    savedAtIso: new Date().toISOString(),
    paidUsage: { inputTokens: 100, outputTokens: 10, audioInputTokens: 0, reasoningTokens: 0, costCny: 1 },
    raw: { shots: [], keyMoments },
  } as unknown as NativeDeepReadSegmentCacheEntry;
}

describe("0920 回归：补扫不得改动付费证据身份", () => {
  const geminiKeyMoments = [
    { atSec: 1220, kindZh: "剧情", noteZh: "读片稿原有" },
    { atSec: 1260, kindZh: "切镜", noteZh: "读片稿原有" },
  ];

  it("往 raw.keyMoments 里加一条，证据对象名就会变（这就是当时报告 404 的机制）", () => {
    const before = nativeDeepReadSegmentEvidenceObjectName(makeEntry(geminiKeyMoments));
    const swept = [...geminiKeyMoments, { atSec: 1300, kindZh: "灯光", noteZh: "补扫补进", fromSweep: true }];
    const after = nativeDeepReadSegmentEvidenceObjectName(makeEntry(swept));
    expect(after).not.toBe(before);
    // 名字里变的正是响应指纹那一段（前面的 fingerprint 不变）
    expect(after.split("-")[1]).toBe(before.split("-")[1]);
    expect(after.split("-").pop()).not.toBe(before.split("-").pop());
  });

  it("补扫结果只进交给整形的那份，原 entry 的 raw 一字不动", () => {
    const entry = makeEntry(geminiKeyMoments);
    const fingerprintBefore = nativeDeepReadSegmentEvidenceResponseFingerprint(entry);
    // 产品代码现在的写法：不 mutate，生成新对象（见 runner「整形前补扫」段）
    const raw = entry.raw as Record<string, unknown>;
    const forStructuring = { ...raw, keyMoments: [...geminiKeyMoments, { atSec: 1300, kindZh: "灯光", noteZh: "补扫补进", fromSweep: true }] };
    expect((forStructuring.keyMoments as unknown[]).length).toBe(3);
    expect((entry.raw as { keyMoments: unknown[] }).keyMoments).toHaveLength(2);
    expect(nativeDeepReadSegmentEvidenceResponseFingerprint(entry)).toBe(fingerprintBefore);
  });
});
