import { describe, expect, it } from "vitest";
import { parseNativeProbeManifest } from "./manhuaNativeDeepReadProbeManifest";

function validManifest() {
  return {
    schemaVersion: 1,
    sourceDigest: "a".repeat(64),
    sourceDurationSec: 611.4,
    segments: [
      {
        segmentIndex: 0,
        startSec: 0,
        endSec: 300.3,
        gsUri: "gs://probe-bucket/series/segment-0.mp4",
        bytes: 123456,
        hasAudio: true,
      },
      {
        segmentIndex: 1,
        startSec: 300.3,
        endSec: 611.4,
        gsUri: "gs://probe-bucket/series/segment-1.mp4",
        bytes: 234567,
        hasAudio: false,
      },
    ],
  };
}

describe("parseNativeProbeManifest", () => {
  it("保留明确映射的300.3秒边界、变长分片和无音轨状态，不改动输入", () => {
    const input = validManifest();
    const before = structuredClone(input);
    const result = parseNativeProbeManifest(input);
    expect(result).toEqual(before);
    expect(input).toEqual(before);
    expect(result).not.toBe(input);
    expect(result.segments[0]).not.toBe(input.segments[0]);
  });

  it("允许一个完整的变长分片", () => {
    const input = validManifest();
    input.sourceDurationSec = 300.3;
    input.segments = input.segments.slice(0, 1);
    expect(parseNativeProbeManifest(input).sourceDurationSec).toBe(300.3);
  });

  it("拒绝稀疏数组中的空洞分片", () => {
    const input = validManifest();
    input.segments.length = 3;
    expect(() => parseNativeProbeManifest(input)).toThrow();
  });

  it("允许相邻秒位和全长存在1e-6以内浮点计算误差，但不改写映射", () => {
    const input = validManifest();
    input.segments[1].startSec += 1e-7;
    input.segments[1].endSec += 1e-7;
    expect(parseNativeProbeManifest(input)).toEqual(input);
  });

  it("允许32片并在付费前拒绝生产证据无法保存的第33片", () => {
    const input = validManifest();
    input.sourceDurationSec = 32;
    input.segments = Array.from({ length: 32 }, (_, index) => ({
      segmentIndex: index,
      startSec: index,
      endSec: index + 1,
      gsUri: `gs://probe-bucket/series/segment-${index}.mp4`,
      bytes: 123,
      hasAudio: true,
    }));
    expect(parseNativeProbeManifest(input).segments).toHaveLength(32);
    input.sourceDurationSec = 33;
    input.segments.push({
      segmentIndex: 32, startSec: 32, endSec: 33,
      gsUri: "gs://probe-bucket/series/segment-32.mp4", bytes: 123, hasAudio: true,
    });
    expect(() => parseNativeProbeManifest(input)).toThrow();
  });

  it.each([null, undefined, [], 1, "manifest", true])("拒绝非对象根值：%j", (value) => {
    expect(() => parseNativeProbeManifest(value)).toThrow();
  });

  it.each([0, 2, "1", null, undefined])("拒绝不匹配的schemaVersion：%j", (schemaVersion) => {
    expect(() => parseNativeProbeManifest({ ...validManifest(), schemaVersion })).toThrow();
  });

  it.each(["", " \n\t", null, undefined, 123])("拒绝缺失或空白sourceDigest：%j", (sourceDigest) => {
    expect(() => parseNativeProbeManifest({ ...validManifest(), sourceDigest })).toThrow();
  });

  it.each([
    "source-digest-from-original-probe",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    ` ${"a".repeat(64)}`,
    `${"a".repeat(64)}\n`,
  ])("拒绝不符合生产证据落盘要求的sourceDigest：%j", (sourceDigest) => {
    expect(() => parseNativeProbeManifest({ ...validManifest(), sourceDigest })).toThrow();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "611.4", null, undefined])(
    "拒绝无效片长：%j", (sourceDurationSec) => {
      expect(() => parseNativeProbeManifest({ ...validManifest(), sourceDurationSec })).toThrow();
    },
  );

  it.each([[], {}, null, undefined, "segments"])("拒绝空或非数组分片：%j", (segments) => {
    expect(() => parseNativeProbeManifest({ ...validManifest(), segments })).toThrow();
  });

  it("拒绝根对象和分片的额外字段", () => {
    expect(() => parseNativeProbeManifest({ ...validManifest(), legacyIndex: [] })).toThrow();
    const input = validManifest();
    const segments = input.segments.map((segment) => ({ ...segment, durationSec: 300 }));
    expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
  });

  it("拒绝没有绝对秒位映射的旧分片索引，不按数组位置猜边界", () => {
    expect(() => parseNativeProbeManifest({
      batches: [{ files: ["gs://probe-bucket/segment-0.mp4"] }],
    })).toThrow();
    const input = validManifest();
    const { startSec: _startSec, endSec: _endSec, ...unmapped } = input.segments[0];
    expect(() => parseNativeProbeManifest({ ...input, segments: [unmapped] })).toThrow();
  });

  it.each([null, [], "segment", 1])("拒绝非对象分片：%j", (segment) => {
    expect(() => parseNativeProbeManifest({ ...validManifest(), segments: [segment] })).toThrow();
  });

  it.each([-1, 1, 0.5, "0", null, undefined])("拒绝非零起点索引：%j", (segmentIndex) => {
    const input = validManifest();
    const segments = [{ ...input.segments[0], segmentIndex }, input.segments[1]];
    expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
  });

  it.each([0, 2, 1.5, "1", null, undefined])("拒绝第二片不连续索引：%j", (segmentIndex) => {
    const input = validManifest();
    const segments = [input.segments[0], { ...input.segments[1], segmentIndex }];
    expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "0", null, undefined])(
    "拒绝无效startSec：%j", (startSec) => {
      const input = validManifest();
      const segments = [{ ...input.segments[0], startSec }, input.segments[1]];
      expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "300.3", null, undefined])(
    "拒绝无效或零长度endSec：%j", (endSec) => {
      const input = validManifest();
      const segments = [{ ...input.segments[0], endSec }, input.segments[1]];
      expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
    },
  );

  it("拒绝首片缺口、段间缺口、重叠、逆序和尾片未覆盖全长", () => {
    for (const patch of [
      { index: 0, startSec: 0.1 },
      { index: 1, startSec: 300.4 },
      { index: 1, startSec: 300.2 },
      { index: 1, startSec: 612 },
      { index: 1, endSec: 611.3 },
      { index: 1, endSec: 611.5 },
    ]) {
      const input = validManifest();
      const { index, ...changes } = patch;
      Object.assign(input.segments[index], changes);
      expect(() => parseNativeProbeManifest(input)).toThrow();
    }
    const reversed = validManifest();
    reversed.segments.reverse();
    expect(() => parseNativeProbeManifest(reversed)).toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "123", null, undefined])(
    "拒绝非正整数字节数：%j", (bytes) => {
      const input = validManifest();
      const segments = [{ ...input.segments[0], bytes }, input.segments[1]];
      expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
    },
  );

  it.each([0, 1, "true", "false", null, undefined])("hasAudio必须明确为boolean：%j", (hasAudio) => {
    const input = validManifest();
    const segments = [{ ...input.segments[0], hasAudio }, input.segments[1]];
    expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
  });

  it.each([
    "https://storage.googleapis.com/probe-bucket/segment.mp4",
    "gs:///segment.mp4",
    "gs://probe-bucket/",
    "gs://probe-bucket",
    "gs://user@probe-bucket/segment.mp4",
    "gs://probe-bucket:443/segment.mp4",
    "gs://probe-bucket/segment.mp4?token=value",
    "gs://probe-bucket/segment.mp4#fragment",
    "gs://probe-bucket/../segment.mp4",
    "gs://probe-bucket/a/./segment.mp4",
    "gs://probe-bucket/a/%2e%2e/segment.mp4",
    "gs://probe-bucket/a/%252e%252e/segment.mp4",
    "gs://probe-bucket/a%2f..%2fsegment.mp4",
    "gs://probe-bucket/a\\..\\segment.mp4",
    "gs://probe-bucket/a%5c..%5csegment.mp4",
    "gs://probe-bucket/segment\n.mp4",
    "gs://probe-bucket/segment%.mp4",
    " gs://probe-bucket/segment.mp4",
    "gs://probe-bucket/segment.mp4 ",
    null,
    undefined,
    123,
  ])("拒绝无效地址或路径遍历：%j", (gsUri) => {
    const input = validManifest();
    const segments = [{ ...input.segments[0], gsUri }, input.segments[1]];
    expect(() => parseNativeProbeManifest({ ...input, segments })).toThrow();
  });

  it("拒绝重复gsUri以免把同一文件冒充多个分片", () => {
    const input = validManifest();
    input.segments[1].gsUri = input.segments[0].gsUri;
    expect(() => parseNativeProbeManifest(input)).toThrow();
  });

  it.each([
    "gs://probe-bucket/segment%2D0.mp4",
    "gs://probe-bucket/片段-0.mp4",
    "gs://probe-bucket/segment 0.mp4",
    "gs://probe-bucket/segment--0.mp4",
    "gs://probe-bucket//segment-0.mp4",
    "gs://probe-bucket/segment+0.mp4",
  ])("拒绝会被生产GCS工具改写的对象地址：%j", (gsUri) => {
    const input = validManifest();
    input.segments[0].gsUri = gsUri;
    expect(() => parseNativeProbeManifest(input)).toThrow();
  });
});
