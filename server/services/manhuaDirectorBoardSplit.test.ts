import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const gcsStore = new Map<string, Buffer>();
const uploadBufferToGcs = vi.fn(async (params: { objectName: string; buffer: Buffer }) => {
  const gcsUri = `gs://test-bucket/${params.objectName}`;
  gcsStore.set(gcsUri, params.buffer);
  return { bucket: "test-bucket", objectName: params.objectName, gcsUri };
});
const signGsUriV4ReadUrl = vi.fn(
  (gcsUri: string, _expiresSeconds?: number) => `https://signed.example/${encodeURIComponent(gcsUri)}`,
);

vi.mock("./gcs.js", () => ({
  uploadBufferToGcs: (...args: [{ objectName: string; buffer: Buffer; contentType: string }]) =>
    uploadBufferToGcs(...args),
  signGsUriV4ReadUrl: (...args: [string, number?]) => signGsUriV4ReadUrl(...args),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/** 造一张 1672×941 的仿真导演板：主画面区一色，右栏/底栏另一色，用来验证裁切边界。 */
async function makeFakeDirectorBoard(): Promise<Buffer> {
  const width = 1672;
  const height = 941;
  const mainColor = { r: 10, g: 20, b: 200 }; // 主画面：蓝
  const asideColor = { r: 250, g: 10, b: 10 }; // 右栏/底栏：红
  const base = sharp({ create: { width, height, channels: 3, background: asideColor } });
  const mainWidth = Math.round(width * 0.772);
  const mainHeight = Math.round(height * 0.712);
  const mainTile = await sharp({
    create: { width: mainWidth, height: mainHeight, channels: 3, background: mainColor },
  })
    .png()
    .toBuffer();
  return base
    .composite([{ input: mainTile, left: 0, top: 0 }])
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

async function cornerPixel(
  buf: Buffer,
  corner: "topRight" | "bottomLeft",
): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const x = corner === "topRight" ? info.width - 1 : 0;
  const y = corner === "bottomLeft" ? info.height - 1 : 0;
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

describe("manhuaDirectorBoardSplit", () => {
  afterEach(() => {
    gcsStore.clear();
    uploadBufferToGcs.mockClear();
    signGsUriV4ReadUrl.mockClear();
    fetchMock.mockReset();
  });

  describe("cropDirectorBoardMainBuffer", () => {
    it("crops the 1672x941 board down to the 1291x670 main picture, dropping the right/bottom bands", async () => {
      const board = await makeFakeDirectorBoard();
      const { cropDirectorBoardMainBuffer } = await import("./manhuaDirectorBoardSplit.js");
      const { buffer, width, height } = await cropDirectorBoardMainBuffer(board);
      expect(width).toBe(1291);
      expect(height).toBe(670);
      // 主画面中心应还是蓝，不该混进右栏/底栏的红
      await expect(centerPixel(buffer)).resolves.toEqual([10, 20, 200]);
    });
  });

  describe("cropManhuaDirectorBoardMainFromUrl", () => {
    it("downloads, crops to main-picture-only, uploads once, and returns gcsUri + signed url", async () => {
      const board = await makeFakeDirectorBoard();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => board.buffer.slice(board.byteOffset, board.byteOffset + board.byteLength),
      });
      const { cropManhuaDirectorBoardMainFromUrl } = await import("./manhuaDirectorBoardSplit.js");
      const result = await cropManhuaDirectorBoardMainFromUrl({
        boardUrl: "https://cdn.example/ep01-board-full.png",
      });
      expect(result.width).toBe(1291);
      expect(result.height).toBe(670);
      expect(result.gcsUri).toMatch(/^gs:\/\/test-bucket\/manhua\/director-board-main\//);
      expect(result.url).toBe(`https://signed.example/${encodeURIComponent(result.gcsUri)}`);
      expect(uploadBufferToGcs).toHaveBeenCalledTimes(1);
    });

    it("throws a clear error when the download fails", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
      const { cropManhuaDirectorBoardMainFromUrl } = await import("./manhuaDirectorBoardSplit.js");
      await expect(
        cropManhuaDirectorBoardMainFromUrl({ boardUrl: "https://cdn.example/missing.png" }),
      ).rejects.toThrow(/director_board_download_failed_404/);
    });
  });
});
