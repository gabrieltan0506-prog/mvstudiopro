/**
 * 漫剧剧种推断探针（本地，无网）：关键词 → 剧种 → 场景包是否注入 prompt。
 *   pnpm run manhua:genre-probe
 */
import {
  buildManhuaStagePromptWithGenre,
  inferManhuaGenreFromTopic,
  resolveManhuaGenreId,
} from "../shared/screenwriterGenreTemplates.ts";

const cases: Array<{ topic: string; expect: string }> = [
  { topic: "仙门外门弟子闯秘境", expect: "xianxia" },
  { topic: "皇宫大殿权谋对峙", expect: "ancient" },
  { topic: "霸总办公室玻璃幕墙", expect: "urban" },
  { topic: "校园教室窗边阳光", expect: "campus" },
  { topic: "废土避难所抢物资", expect: "apocalypse" },
  { topic: "太空基地任务出发", expect: "scifi" },
  { topic: "密室探案搜集线索", expect: "suspense" },
];

let failed = 0;
for (const c of cases) {
  const r = resolveManhuaGenreId({ topic: c.topic });
  const ok = r.inferred && r.genreId === c.expect;
  const story = buildManhuaStagePromptWithGenre("story_brief", {
    genreId: r.genreId,
    topic: c.topic,
  });
  const hasScene = story.includes("【漫剧场景资产库");
  const lineOk = ok && hasScene;
  console.log(
    `[${lineOk ? "PASS" : "FAIL"}] topic=${c.topic} → ${r.genreId || "null"} (expect ${c.expect}) scene=${hasScene}`,
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

if (failed) {
  console.error(`[manhua-genre-probe] FAILED ${failed}`);
  process.exit(1);
}
console.log("[manhua-genre-probe] OK");
