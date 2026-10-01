import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { cropManhuaSheet2x2ToGcs, cropSheet2x2ToTiles, sheetObjectPath } from "./manhuaSheetGridCrop";
import { __resetCanvasMediaOwnershipCacheForTests, verifyCanvasMediaOwnership, type OwnerRecord, type OwnerStore } from "./canvasMediaOwnership";
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), uploads: vi.fn() }));
vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  downloadGcsObject: async ({ gcsUri }: { gcsUri: string }) => {
    const buffer = storage.objects.get(gcsUri);
    if (!buffer) throw new Error("gcs_download_failed:404:missing");
    return { buffer };
  },
  uploadBufferToGcsIfAbsent: async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    storage.uploads(objectName); storage.objects.set(`gs://test-bucket/${objectName}`, buffer);
    return { created: true };
  },
  signGsUriV4ReadUrl: (u: string) => u.replace("gs://test-bucket/", "https://storage.googleapis.com/test-bucket/"),
}));
const source = "generated/canvas-gpt-image2/1.png";
const tile = "manhua-scene-tiles/wa_scene_cerd/1789526833050-topRight.png";
const url = (p: string) => `https://storage.googleapis.com/test-bucket/${p}`;
async function fixture() {
  const sheet = await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } }).png().toBuffer();
  const tiles = await cropSheet2x2ToTiles(sheet);
  storage.objects.set(`gs://test-bucket/${source}`, sheet);
  storage.objects.set(`gs://test-bucket/${tile}`, tiles[1].buffer);
  const records = new Map<string, OwnerRecord>([[source, { ownerUserId: 7 }]]);
  const writes = vi.fn();
  const store: OwnerStore = {
    get: async (p) => records.get(p) || null,
    createIfAbsent: async (p, rec) => { writes(p); if (records.has(p)) return "exists"; records.set(p, rec); return "created"; },
  };
  return { records, writes, store };
}
beforeEach(() => { storage.objects.clear(); storage.uploads.mockClear(); __resetCanvasMediaOwnershipCacheForTests(); });
describe("authenticated scene tile ownership", () => {
  it("restores the actual legacy tile, registers once, preserves bytes and rejects another owner", async () => {
    const { store, writes } = await fixture();
    const original = Buffer.from(storage.objects.get(`gs://test-bucket/${tile}`)!);
    const input = { sheetUrl: `/api/canvas-media/${source}`, userId: 7, existingTiles: { topRight: url(tile) }, store };
    const result = await cropManhuaSheet2x2ToGcs(input);
    expect(result.map(x => x.gcsUri)).toEqual([`gs://test-bucket/${tile}`]);
    expect(await verifyCanvasMediaOwnership(7, tile, { store, skipCache: true })).toBe(true);
    expect(await verifyCanvasMediaOwnership(8, tile, { store, skipCache: true })).toBe(false);
    await cropManhuaSheet2x2ToGcs(input);
    expect(writes).toHaveBeenCalledTimes(2); // create-if-absent is safely idempotent
    expect(storage.uploads).not.toHaveBeenCalled();
    expect(storage.objects.get(`gs://test-bucket/${tile}`)).toEqual(original);
  });
  it("rejects a source owned by another user before download/upload/register", async () => {
    const { store, writes } = await fixture();
    await expect(cropManhuaSheet2x2ToGcs({ sheetUrl: url(source), userId: 8, existingTiles: { topRight: url(tile) }, store })).rejects.toThrow("sheet_owner_forbidden");
    expect(writes).not.toHaveBeenCalled(); expect(storage.uploads).not.toHaveBeenCalled();
  });
  it("rejects mismatching bytes without registering or overwriting", async () => {
    const { store, writes } = await fixture();
    const wrong = await sharp({ create: { width: 4, height: 3, channels: 3, background: "blue" } }).png().toBuffer();
    storage.objects.set(`gs://test-bucket/${tile}`, wrong);
    await expect(cropManhuaSheet2x2ToGcs({ sheetUrl: url(source), userId: 7, existingTiles: { topRight: url(tile) }, store })).rejects.toThrow("sheet_tile_source_mismatch");
    expect(writes).not.toHaveBeenCalled(); expect(storage.objects.get(`gs://test-bucket/${tile}`)).toEqual(wrong);
  });
  it("never steals an already registered tile", async () => {
    const { store, records, writes } = await fixture(); records.set(tile, { ownerUserId: 8 });
    await expect(cropManhuaSheet2x2ToGcs({ sheetUrl: url(source), userId: 7, existingTiles: { topRight: url(tile) }, store })).rejects.toThrow("sheet_owner_conflict");
    expect(records.get(tile)?.ownerUserId).toBe(8); expect(writes).not.toHaveBeenCalled();
  });
  it("new crops register all four actual delivered objects", async () => {
    const { store } = await fixture();
    const result = await cropManhuaSheet2x2ToGcs({ sheetUrl: url(source), userId: 7, store });
    expect(result).toHaveLength(4); expect(storage.uploads).toHaveBeenCalledTimes(4);
    for (const out of result) expect(await verifyCanvasMediaOwnership(7, sheetObjectPath(out.url), { store, skipCache: true })).toBe(true);
  });
  it("rejects external bucket, arbitrary HTTPS, traversal and wrong slot", async () => {
    const { store, writes } = await fixture();
    for (const bad of ["https://storage.googleapis.com/other/generated/a/1.png", "https://example.com/x.png", "gs://test-bucket/generated/a/../1.png"]) expect(() => sheetObjectPath(bad)).toThrow("sheet_source_invalid");
    await expect(cropManhuaSheet2x2ToGcs({ sheetUrl: url(source), userId: 7, existingTiles: { topLeft: url(tile) }, store })).rejects.toThrow("sheet_tile_invalid");
    expect(writes).not.toHaveBeenCalled();
  });
});
