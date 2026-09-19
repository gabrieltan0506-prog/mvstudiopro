import { expect, it } from "vitest";
import { spawnManhuaDramaStudio, expandManhuaShotKeyartsAfterReverse, ensureManhuaFragmentClips, queuedManhuaClipBlocks } from "./canvasDramaStudio";
import { normalizeManhuaCustomAssetRefs } from "@shared/manhuaCustomAssetRefs";
import type { ManhuaSceneSpace } from "@shared/manhuaSceneSpace";
it("实际段编译消费同一场景空间版本，换图后停止注入", () => {
 const model = "seedance-2.0-mini";
 const spawned = spawnManhuaDramaStudio({ topic: "医馆后院", episodeIndex: 1, videoModel: model });
 const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
 const expanded = expandManhuaShotKeyartsAfterReverse(spawned.blocks.map(b => b.id === reverse.id ? { ...b, status: "done" as const, outputText: Array.from({ length: 18 }, (_, i) => `${i + 1}. 第${i + 1}镜：医馆后院，阿菁从木门走入诊室`).join("\n") } : b), spawned.edges, reverse.id);
 const blocks = expanded.blocks.map(b => b.id.startsWith("keyart-") ? { ...b, status: "done" as const, outputUrl: `https://test.example/${b.id}.jpg` } : b);
 const space: ManhuaSceneSpace = { version: 1, sourceRefId: "clinic", sourceVersion: "gs://test/clinic.png", revision: 7, status: "approved", sourceNoteZh: "原稿医馆门槛", zones: [{ id: "yard", labelZh: "后院", fixedFeaturesZh: "井台在东" }, { id: "room", labelZh: "诊室", fixedFeaturesZh: "药柜在北" }], passages: [{ id: "door", fromId: "yard", toId: "room", labelZh: "木门", bidirectional: true }] };
 const refs = normalizeManhuaCustomAssetRefs([{ id: "clinic", role: "scene", labelZh: "医馆后院", url: "https://test.example/clinic.png", gcsUri: space.sourceVersion, sceneSpace: space }]);
 const compile = (customRefs: typeof refs) => queuedManhuaClipBlocks(ensureManhuaFragmentClips(blocks, expanded.edges, 1, { videoModel: model, customRefs }).blocks, 1, model).map(b => b.prompt).join("\n");
 expect(compile(refs)).toContain("【场景空间·clinic·v7】");
 expect(compile(refs)).toContain("后院↔诊室（木门）");
 const changedRefs = refs.map(ref => ({ ...ref, gcsUri: "gs://test/clinic-v2.png" }));
 expect(compile(changedRefs)).not.toContain("【场景空间");
 const initial = ensureManhuaFragmentClips(blocks, expanded.edges, 1, { videoModel: model, customRefs: refs });
 const annotated = initial.blocks.map(b => b.kind === "video" ? { ...b, prompt: `${b.prompt}\n\n【用户补充】\n保留门外反应镜` } : b);
 const refreshed = ensureManhuaFragmentClips(annotated, initial.edges, 1, { videoModel: model, customRefs: changedRefs });
 const refreshedClips = queuedManhuaClipBlocks(refreshed.blocks, 1, model);
 expect(refreshedClips.length).toBeGreaterThan(0);
 for (const clip of refreshedClips) {
   expect(clip.prompt).not.toContain("【场景空间");
   expect(clip.prompt).toContain("保留门外反应镜");
 }

});
