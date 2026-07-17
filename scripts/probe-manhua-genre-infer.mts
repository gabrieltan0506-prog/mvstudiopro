/**
 * 漫剧剧种/场景推断探针（本地，无网）：关键词 → 剧种 → 具体场景注入。
 *   pnpm run manhua:genre-probe
 */
import { recommendManhuaSceneFromTopic } from "../shared/manhuaSceneAssetLibrary.ts";
import {
  buildManhuaStagePromptWithGenre,
  inferManhuaGenreFromTopic,
  recommendManhuaSceneIdFromTopic,
  resolveManhuaGenreId,
} from "../shared/screenwriterGenreTemplates.ts";

const cases: Array<{ topic: string; expectGenre: string; expectSceneName: string }> = [
  { topic: "仙门外门弟子闯秘境", expectGenre: "xianxia", expectSceneName: "秘境洞府" },
  { topic: "皇宫大殿权谋对峙", expectGenre: "ancient", expectSceneName: "皇宫大殿" },
  { topic: "霸总办公室玻璃幕墙", expectGenre: "urban", expectSceneName: "都市办公室" },
  { topic: "校园教室窗边阳光", expectGenre: "campus", expectSceneName: "校园教室" },
  { topic: "废土避难所抢物资", expectGenre: "apocalypse", expectSceneName: "废土避难所" },
  { topic: "太空基地任务出发", expectGenre: "scifi", expectSceneName: "太空基地" },
  { topic: "密室探案搜集线索", expectGenre: "suspense", expectSceneName: "密室探案现场" },
];

let failed = 0;
for (const c of cases) {
  const r = resolveManhuaGenreId({ topic: c.topic });
  const sceneRec = recommendManhuaSceneIdFromTopic({ topic: c.topic });
  const story = buildManhuaStagePromptWithGenre("story_brief", {
    genreId: r.genreId,
    topic: c.topic,
  });
  const genreOk = r.inferred && r.genreId === c.expectGenre;
  const sceneOk = story.includes(c.expectSceneName) && sceneRec.sceneId;
  const hasSceneBlock = story.includes("【漫剧场景资产库");
  const lineOk = Boolean(genreOk && sceneOk && hasSceneBlock);
  console.log(
    `[${lineOk ? "PASS" : "FAIL"}] topic=${c.topic} → ${r.genreId || "null"}/${sceneRec.sceneId || "null"} (expect ${c.expectGenre}/${c.expectSceneName})`,
  );
  if (!lineOk) failed += 1;
}

const manual = resolveManhuaGenreId({ genreId: "campus", topic: "太空飞船" });
const manualOk = !manual.inferred && manual.genreId === "campus";
console.log(`[${manualOk ? "PASS" : "FAIL"}] 手动剧种优先于题材推断`);
if (!manualOk) failed += 1;

const none = inferManhuaGenreFromTopic("今天吃面");
console.log(`[${!none ? "PASS" : "FAIL"}] 无关键词不瞎套剧种`);
if (none) failed += 1;

const mijing = recommendManhuaSceneFromTopic("闯秘境");
const mijingOk = mijing.sceneId === "scene_04";
console.log(`[${mijingOk ? "PASS" : "FAIL"}] 秘境关键词 → scene_04`);
if (!mijingOk) failed += 1;

const viralCases: Array<{ topic: string; expectScene: string }> = [
  { topic: "发配边关罪妻开荒养出战神", expectScene: "scene_10" },
  { topic: "从赖皮蛇开始吞噬进化", expectScene: "scene_04" },
  { topic: "气运三角洲操作吊打全球", expectScene: "scene_15" },
  { topic: "末世废柴开超市", expectScene: "scene_17" },
];
for (const c of viralCases) {
  const hit = recommendManhuaSceneFromTopic(c.topic).sceneId === c.expectScene;
  console.log(`[${hit ? "PASS" : "FAIL"}] viral ${c.topic} → ${c.expectScene}`);
  if (!hit) failed += 1;
}

if (failed) {
  console.error(`[manhua-genre-probe] FAILED ${failed}`);
  process.exit(1);
}
console.log("[manhua-genre-probe] OK");
