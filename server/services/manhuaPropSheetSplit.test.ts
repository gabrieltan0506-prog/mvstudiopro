import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// 全量并发下 sharp 等重模块加载计入用例预算，5s 默认线负载抽签超时
//（机制同 56daf878 / 0e08ec7f，断言零改动）
vi.setConfig({ testTimeout: 60_000 });

const gcsStore = new Map<string, Buffer>();
const downloadGcsObject = vi.fn(async (params: { gcsUri: string }) => {
  const buf = gcsStore.get(params.gcsUri);
  if (!buf) throw new Error("gcs_download_failed:404:not found");
  return { buffer: buf, bucket: "test-bucket", objectName: params.gcsUri };
});
const uploadBufferToGcs = vi.fn(async (params: { objectName: string; buffer: Buffer }) => {
  const gcsUri = `gs://test-bucket/${params.objectName}`;
  gcsStore.set(gcsUri, params.buffer);
  return { bucket: "test-bucket", objectName: params.objectName, gcsUri };
});
const signGsUriV4ReadUrl = vi.fn(
  (gcsUri: string, _expiresSeconds?: number) => `https://signed.example/${encodeURIComponent(gcsUri)}`,
);
const getGcsBucketName = vi.fn(() => "test-bucket");

vi.mock("./gcs.js", () => ({
  downloadGcsObject: (...args: [{ gcsUri: string }]) => downloadGcsObject(...args),
  uploadBufferToGcs: (...args: [{ objectName: string; buffer: Buffer; contentType: string }]) =>
    uploadBufferToGcs(...args),
  signGsUriV4ReadUrl: (...args: [string, number?]) => signGsUriV4ReadUrl(...args),
  getGcsBucketName: () => getGcsBucketName(),
}));

const runCanvasTerraVisionMarkdown = vi.fn();
vi.mock("./canvasTerraMultimodal.js", () => ({
  runCanvasTerraVisionMarkdown: (...args: unknown[]) => runCanvasTerraVisionMarkdown(...args),
}));

vi.mock("./evolinkChatModel.js", () => ({
  EVOLINK_CHAT_MODEL_GPT56_TERRA: "gpt-5.6-terra",
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/** 4x2 网格，每格刷不同纯色，用于验证裁切框切到了正确的格子 */
async function makeEightColorSheet(): Promise<Buffer> {
  const width = 800;
  const height = 500;
  const topBand = 50;
  const cellW = width / 4;
  const cellH = (height - topBand) / 2;
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
    [128, 64, 0],
    [64, 0, 128],
  ];
  const tiles = await Promise.all(
    colors.map(([r, g, b]) =>
      sharp({ create: { width: cellW, height: cellH, channels: 3, background: { r, g, b } } })
        .png()
        .toBuffer(),
    ),
  );
  const composite = tiles.map((buf, i) => ({
    input: buf,
    left: (i % 4) * cellW,
    top: topBand + Math.floor(i / 4) * cellH,
  }));
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .composite(composite)
    .png()
    .toBuffer();
}

async function centerPixel(buf: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const cx = Math.floor(info.width / 2);
  const cy = Math.floor(info.height / 2);
  const at = (cy * info.width + cx) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

describe("manhuaPropSheetSplit", () => {
  afterEach(() => {
    gcsStore.clear();
    downloadGcsObject.mockClear();
    uploadBufferToGcs.mockClear();
    signGsUriV4ReadUrl.mockClear();
    runCanvasTerraVisionMarkdown.mockReset();
    fetchMock.mockReset();
  });

  describe("parsePropSheetTitleLine / parsePropSheetTitlesFromMarkdown", () => {
    it("splits name/note on the ｜ separator", async () => {
      const { parsePropSheetTitleLine } = await import("./manhuaPropSheetSplit.js");
      expect(parsePropSheetTitleLine('灰札｜仅存"弃城"二字')).toEqual({
        name: "灰札",
        note: '仅存"弃城"二字',
      });
      expect(parsePropSheetTitleLine("残玉")).toEqual({ name: "残玉", note: "" });
    });

    it("strips numbered-list prefixes and takes the first N lines in grid order", async () => {
      const { parsePropSheetTitlesFromMarkdown } = await import("./manhuaPropSheetSplit.js");
      const md = [
        "1. 残玉",
        "2. 修复锥与修复笔｜锥与笔",
        "- 良甲甲片",
        "",
        "4. 劣甲甲片",
        "5. 多出来的一行不该被取到",
      ].join("\n");
      const titles = parsePropSheetTitlesFromMarkdown(md, 4);
      expect(titles).toEqual([
        { name: "残玉", note: "" },
        { name: "修复锥与修复笔", note: "锥与笔" },
        { name: "良甲甲片", note: "" },
        { name: "劣甲甲片", note: "" },
      ]);
    });
  });

  describe("splitPropSheetBuffer", () => {
    it("crops a 4x2 sheet into 8 correctly-positioned tiles", async () => {
      const sheet = await makeEightColorSheet();
      const { splitPropSheetBuffer } = await import("./manhuaPropSheetSplit.js");
      const tiles = await splitPropSheetBuffer(sheet, { cols: 4, rows: 2 });
      expect(tiles).toHaveLength(8);
      const expectedColors: [number, number, number][] = [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
        [255, 0, 255],
        [0, 255, 255],
        [128, 64, 0],
        [64, 0, 128],
      ];
      for (let i = 0; i < 8; i += 1) {
        await expect(centerPixel(tiles[i]!.buffer)).resolves.toEqual(expectedColors[i]);
      }
    });
  });

  describe("resolvePropSheetTitles", () => {
    it("calls the vision model once on cache miss, then hits the GCS cache on the next call (no repeat call)", async () => {
      runCanvasTerraVisionMarkdown.mockResolvedValueOnce({
        markdown: ["残玉", "修复锥与修复笔｜锥与笔", "良甲甲片", "劣甲甲片"].join("\n"),
        imageCount: 1,
        model: "gpt-5.6-terra",
      });
      const { resolvePropSheetTitles } = await import("./manhuaPropSheetSplit.js");
      const buffer = Buffer.from("fake-sheet-bytes");
      const sha256 = "deadbeef";

      const first = await resolvePropSheetTitles({ buffer, sha256, cols: 2, rows: 2 });
      expect(first.fromCache).toBe(false);
      expect(first.titles).toEqual([
        { name: "残玉", note: "" },
        { name: "修复锥与修复笔", note: "锥与笔" },
        { name: "良甲甲片", note: "" },
        { name: "劣甲甲片", note: "" },
      ]);
      expect(runCanvasTerraVisionMarkdown).toHaveBeenCalledTimes(1);
      expect(uploadBufferToGcs).toHaveBeenCalledTimes(1);

      const second = await resolvePropSheetTitles({ buffer, sha256, cols: 2, rows: 2 });
      expect(second.fromCache).toBe(true);
      expect(second.titles).toEqual(first.titles);
      // 缓存命中：视觉模型不应被再次调用
      expect(runCanvasTerraVisionMarkdown).toHaveBeenCalledTimes(1);
    });

    it("degrades to numbered placeholders instead of throwing when the vision call fails", async () => {
      runCanvasTerraVisionMarkdown.mockRejectedValueOnce(new Error("算力紧张，请稍后再试"));
      const { resolvePropSheetTitles } = await import("./manhuaPropSheetSplit.js");
      const result = await resolvePropSheetTitles({
        buffer: Buffer.from("another-fake-sheet"),
        sha256: "feedface",
        cols: 2,
        rows: 1,
      });
      expect(result.fromCache).toBe(false);
      expect(result.titles).toEqual([
        { name: "道具01", note: "" },
        { name: "道具02", note: "" },
      ]);
    });
  });

  describe("splitManhuaPropSheetFromUrl", () => {
    it("downloads, splits, uploads tiles, and returns items in grid order", async () => {
      const sheet = await makeEightColorSheet();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => sheet.buffer.slice(sheet.byteOffset, sheet.byteOffset + sheet.byteLength),
      });
      runCanvasTerraVisionMarkdown.mockResolvedValueOnce({
        markdown: Array.from({ length: 8 }, (_, i) => `道具${i + 1}`).join("\n"),
        imageCount: 1,
        model: "gpt-5.6-terra",
      });
      const { splitManhuaPropSheetFromUrl } = await import("./manhuaPropSheetSplit.js");
      const result = await splitManhuaPropSheetFromUrl({
        sheetUrl: "https://cdn.example/sheet.png",
        cols: 4,
        rows: 2,
      });
      expect(result.items).toHaveLength(8);
      expect(result.titlesFromCache).toBe(false);
      expect(result.items.map((it) => it.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(result.items[0]!.name).toBe("道具1");
      expect(result.items.every((it) => it.url.startsWith("https://signed.example/"))).toBe(true);
      expect(
        result.items.every((it) => /^gs:\/\/test-bucket\/manhua\/prop-single\//.test(it.gcsUri)),
      ).toBe(true);
      expect(uploadBufferToGcs).toHaveBeenCalledTimes(9); // 8 张单件图 + 1 份标题缓存
    });
  });
});
