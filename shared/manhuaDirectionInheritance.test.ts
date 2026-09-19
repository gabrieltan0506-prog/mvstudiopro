import { expect, it } from "vitest";
import { normalizeManhuaDirectionCanon, resolveManhuaDirectionCard, resolveDirectorStyleBlocks, type ManhuaDirectionOverride } from "./manhuaDirectionCanon";
import { buildManhuaDirectionCanonFromSelection, listManhuaDirectionCards, formatManhuaDirectionSelectionMarker, readManhuaDirectionCanonFromPrompt, stripManhuaDirectionStyleBlocks } from "./manhuaDirectionCanonLibrary";
import { buildManhuaWriterSession, parseManhuaWriterSession, serializeManhuaWriterSession } from "./manhuaWriterSession";
import { buildManhuaDirectorCardView } from "./manhuaDirectorCardView";
const cards = listManhuaDirectionCards().filter(c => c.rules.some(r => r.stages.includes("clip")));
const overrides: ManhuaDirectionOverride[] = [
 { scope: "episode", episodeIndex: 1, cardId: cards[1]!.id, reasonZh: "医馆先交代空间威胁", stages: ["storyboard", "keyframe", "clip"], status: "approved" },
 { scope: "segment", episodeIndex: 1, segmentIndex: 1, cardId: cards[2]!.id, reasonZh: "药碗落点改变谈判关系", stages: ["storyboard", "keyframe", "clip"], status: "approved" },
 { scope: "shot", episodeIndex: 1, shotIndex: 1, cardId: cards[3]!.id, reasonZh: "门外视线揭示取血代价", stages: ["storyboard", "keyframe", "clip"], status: "approved" },
];
const selection = { mainCardId: cards[0]!.id, scopedOverrides: overrides };
it("真实卡库覆盖经会话与节点标记恢复，UI/生产按同身份阶段解析", () => {
 const session = parseManhuaWriterSession(serializeManhuaWriterSession(buildManhuaWriterSession({ directionSelection: selection })))!;
 const canon = buildManhuaDirectionCanonFromSelection(session.directionSelection)!;
 expect(canon.scopedOverrides).toEqual(overrides);
 const marker = formatManhuaDirectionSelectionMarker(canon);
 const restored = readManhuaDirectionCanonFromPrompt(marker)!;
 expect(restored.scopedOverrides).toEqual(overrides);
 expect(stripManhuaDirectionStyleBlocks(`正文\n${marker}\n保留结尾`)).toBe("正文\n\n保留结尾");
 for (const [context, id, scope] of [
  [{episodeIndex:2,segmentIndex:1,shotIndex:1}, cards[0]!.id,"series"],
  [{episodeIndex:1,segmentIndex:2,shotIndex:4}, cards[1]!.id,"episode"],
  [{episodeIndex:1,segmentIndex:1,shotIndex:2}, cards[2]!.id,"segment"],
  [{episodeIndex:1,segmentIndex:1,shotIndex:1}, cards[3]!.id,"shot"],
 ] as const) {
  expect(resolveManhuaDirectionCard(restored,"clip","default",context)).toMatchObject({card:{id},scope});
  expect(buildManhuaDirectorCardView({canon:restored,context,stage:"clip",sceneType:"default",hasSpawnedNodes:true})?.effectiveCardId).toBe(id);
  expect(resolveDirectorStyleBlocks(restored,"default",context).clip).toContain(id);
 }
 expect(resolveManhuaDirectionCard(restored,"story","default",{episodeIndex:1})?.card.id).toBe(cards[0]!.id);
});
it("草稿、空理由及未授权不进入生产；撤回后继承父级", () => {
 const canon = buildManhuaDirectionCanonFromSelection(selection)!;
 for (const patch of [{status:"draft" as const},{reasonZh:" "}]) {
  const next = normalizeManhuaDirectionCanon({...canon,scopedOverrides:overrides.map(o=>o.scope==='shot'?{...o,...patch}:o)})!;
  expect(resolveManhuaDirectionCard(next,"clip","default",{episodeIndex:1,segmentIndex:1,shotIndex:1})?.card.id).toBe(cards[2]!.id);
 }
 const denied = {...canon,authorizedCardIds:canon.authorizedCardIds.filter(id=>id!==cards[3]!.id)};
 expect(resolveManhuaDirectionCard(denied,"clip","default",{episodeIndex:1,segmentIndex:1,shotIndex:1})?.card.id).toBe(cards[2]!.id);
});
