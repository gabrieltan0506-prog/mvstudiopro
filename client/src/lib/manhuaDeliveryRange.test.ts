import { afterEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { defaultCanvasBlock } from "./canvasTypes";
import { exportManhuaProjectZip, resolveManhuaDeliveryEpisodeIndexes } from "./manhuaProjectExport";
const finals = [1, 2].map(ep => ({ ...defaultCanvasBlock("video", 0, 0), id: `final-e0${ep}`, episodeIndex: ep, outputUrl: `https://test.invalid/e${ep}.mp4`, outputUrls: [`https://test.invalid/e${ep}.mp4`], manhuaFinalVersions: [{ url: `https://test.invalid/e${ep}.mp4`, origin: "assemble" as const, createdAt: ep, subtitleTimeline: { version: 1 as const, textSource: "assembly_script_snapshot" as const, timing: "rendered_shot_windows" as const, durationSec: 3, cues: [{ shotIndex: 1, order: 1, startSec: 0, endSec: 2, textZh: `第${ep}集台词` }] } }] }));
afterEach(() => vi.unstubAllGlobals());
it("明确范围拒绝空值、缺当前集、非法编号；全部保留旧默认", () => {
 expect(resolveManhuaDeliveryEpisodeIndexes("all", undefined, [])).toBeUndefined();
 expect(resolveManhuaDeliveryEpisodeIndexes("current", 2, [1])).toEqual([2]);
 expect(resolveManhuaDeliveryEpisodeIndexes("selected", 1, [2, 2, 1])).toEqual([1, 2]);
 for (const values of [[], [0], [1.1], [NaN]]) expect(() => resolveManhuaDeliveryEpisodeIndexes("selected", 1, values)).toThrow();
 expect(() => resolveManhuaDeliveryEpisodeIndexes("current", undefined, [1])).toThrow("当前集");
});
it("真实ZIP、SRT、清单和manifest只消费指定集，旧全量保留", async () => {
 const fetch = vi.fn(async (_url: unknown) => new Response(new Uint8Array([1, 2, 3]))); vi.stubGlobal("fetch", fetch);
 const opts = { items: [], selectedIds: [], blocks: finals, includeLibraryRefs: false, includeDelivery: true, deliveryAudioByFinalUrl: Object.fromEntries(finals.map((b, i) => [b.outputUrl, { url: `https://test.invalid/e${i + 1}.wav`, ext: "wav" as const }])) };
 const result = await exportManhuaProjectZip({ ...opts, deliveryEpisodeIndexes: [2] });
 const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
 expect(Object.keys(zip.files).some(p => p.includes("ep01"))).toBe(false);
 expect(await zip.file("交付/ep02/字幕.srt")!.async("string")).toContain("第2集台词");
 expect(result.manifest.deliveryEpisodeIndexes).toEqual([2]);
 expect(result.manifest.delivery?.every(d => d.episodeIndex === 2)).toBe(true);
 expect(fetch.mock.calls.every(([url]) => String(url).includes("e2."))).toBe(true);
 expect((await exportManhuaProjectZip(opts)).deliveryCount).toBe(2);
 fetch.mockClear(); await expect(exportManhuaProjectZip({ ...opts, deliveryEpisodeIndexes: [] })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
 await expect(exportManhuaProjectZip({ ...opts, deliveryEpisodeIndexes: [3] })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});

it("直调显式范围不泄漏无归属整片链接，省略范围仍保留旧整片元数据", async () => {
 vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
 const finalVideoUrl = "https://test.invalid/all-episodes-secret-cut.mp4";
 const opts = { items: [], selectedIds: [], blocks: finals, includeLibraryRefs: false, includeDelivery: true, finalVideoUrl };
 const scoped = await exportManhuaProjectZip({ ...opts, deliveryEpisodeIndexes: [2] });
 expect(scoped.manifest.finalVideoUrl).toBeUndefined();
 const zip = await JSZip.loadAsync(await scoped.blob.arrayBuffer());
 for (const file of ["manifest.json", "README.md", "playlist.json"]) {
  expect(await zip.file(file)!.async("string")).not.toContain(finalVideoUrl);
 }
 const all = await exportManhuaProjectZip(opts);
 expect(all.manifest.finalVideoUrl).toBe(finalVideoUrl);
 const full = await JSZip.loadAsync(await all.blob.arrayBuffer());
 for (const file of ["manifest.json", "README.md", "playlist.json"]) {
  expect(await full.file(file)!.async("string")).toContain(finalVideoUrl);
 }
});
