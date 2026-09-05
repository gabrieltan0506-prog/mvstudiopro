import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { MANHUA_DIRECTOR_BOARD_BACKUP_FORMAT } from "./manhuaDirectorBoardStore";
import { importManhuaAssetZipFile } from "./manhuaAssetZipImport";

describe("manhuaAssetZipImport director board backup", () => {
  async function importState(raw: string) {
    const zip = new JSZip();
    zip.file("director_boards/state.json", raw);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const uploadOne = vi.fn();
    const task = importManhuaAssetZipFile({
      file: { arrayBuffer: async () => buffer } as File,
      getSignedUploadUrl: vi.fn(),
      uploadOne,
    });
    return { task, uploadOne };
  }

  it("从换剧 ZIP 回填三张导演板表且不把 state.json 当图片上传", async () => {
    const zip = new JSZip();
    zip.file(
      "director_boards/state.json",
      JSON.stringify({
        format: MANHUA_DIRECTOR_BOARD_BACKUP_FORMAT,
        mainByEpisode: { 1: { gcsUri: "gs://bucket/main.png" } },
        bySegment: { 1: { 2: { gcsUri: "gs://bucket/segment.png" } } },
        motionOverlayBySegment: {},
      }),
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const uploadOne = vi.fn();

    const result = await importManhuaAssetZipFile({
      file: { arrayBuffer: async () => buffer } as File,
      getSignedUploadUrl: vi.fn(),
      uploadOne,
    });

    expect(uploadOne).not.toHaveBeenCalled();
    expect(result.directorBoardState).toMatchObject({
      mainByEpisode: { 1: { gcsUri: "gs://bucket/main.png" } },
      bySegment: { 1: { 2: { gcsUri: "gs://bucket/segment.png" } } },
      motionOverlayBySegment: {},
    });
  });

  it("旧格式 ZIP 没有导演板状态时保持兼容", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "legacy" }));
    const buffer = await zip.generateAsync({ type: "arraybuffer" });

    const result = await importManhuaAssetZipFile({
      file: { arrayBuffer: async () => buffer } as File,
      getSignedUploadUrl: vi.fn(),
      uploadOne: vi.fn(),
    });

    expect(result.directorBoardState).toBeNull();
  });

  it.each([
    ["坏 JSON", "{broken", "JSON 无法解析"],
    [
      "未知 format",
      JSON.stringify({
        format: "unknown",
        mainByEpisode: {},
        bySegment: {},
        motionOverlayBySegment: {},
      }),
      "format 版本未知",
    ],
    [
      "坏 maps",
      JSON.stringify({
        format: MANHUA_DIRECTOR_BOARD_BACKUP_FORMAT,
        mainByEpisode: {},
        bySegment: { 1: { 2: { gcsUri: "not-gcs" } } },
        motionOverlayBySegment: {},
      }),
      "bySegment 含无效",
    ],
  ])("存在%s时在上传前拒绝整包", async (_label, raw, error) => {
    const { task, uploadOne } = await importState(raw);
    await expect(task).rejects.toThrow(error);
    expect(uploadOne).not.toHaveBeenCalled();
  });
});
