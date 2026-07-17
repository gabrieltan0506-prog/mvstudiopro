/**
 * 零 token 验收：角色库 id ↔ 静态图 ↔ 注入块 ↔ 同版式 prompt。
 * 用法：pnpm run manhua:character-verify
 */
import fs from "node:fs";
import path from "node:path";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_COUPLE_PACKS,
  MANHUA_TEMPERAMENT_PACKS,
  buildManhuaCharacterPromptBlock,
  buildManhuaCharacterSheetGenPrompt,
  characterMatchesTemperamentPack,
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  parseManhuaCoupleSelection,
  parseManhuaFavoriteIds,
  recommendManhuaArtStyleFromTopic,
  recommendManhuaCharactersFromTopic,
  serializeManhuaCoupleSelection,
  serializeManhuaFavoriteIds,
} from "../shared/manhuaCharacterAssetLibrary";

const root = process.cwd();
const dir = path.join(root, "client/public/manhua-characters");
let failed = 0;

function ok(label: string) {
  console.log(`PASS  ${label}`);
}
function bad(label: string, detail?: string) {
  failed += 1;
  console.error(`FAIL  ${label}${detail ? ` · ${detail}` : ""}`);
}

if (!fs.existsSync(dir)) {
  bad("public/manhua-characters 目录存在");
} else {
  ok("public/manhua-characters 目录存在");
}

for (const c of MANHUA_CHARACTER_ASSET_LIBRARY) {
  const url = getManhuaCharacterPreviewUrl(c.id);
  const file = path.join(dir, `${c.id}.jpg`);
  if (!url.endsWith(`${c.id}.jpg`)) bad(`预览 URL ${c.id}`, url);
  else if (!fs.existsSync(file)) bad(`静态图 ${c.id}.jpg`);
  else if (fs.statSync(file).size < 8_000) bad(`静态图过小 ${c.id}.jpg`);
}

if (failed === 0) ok(`29 张设定卡均齐（库 ${MANHUA_CHARACTER_ASSET_LIBRARY.length}）`);

const block = buildManhuaCharacterPromptBlock(["char_f_01", "char_m_02"], { artStyleId: "cg_drama" });
if (!block.includes("【角色库锚点】") || !block.includes("【画风】") || !block.includes("沈清辞")) {
  bad("注入块含锚点/画风/角色名");
} else ok("注入块含锚点/画风/角色名");

const sheet = buildManhuaCharacterSheetGenPrompt({ characterId: "char_f_01", artStyleId: "photoreal" });
if (!sheet.includes("FRONT / SIDE / BACK") || !sheet.includes("仿真人")) {
  bad("同版式 prompt 含三视图与画风");
} else ok("同版式 prompt 含三视图与画风");

const urban = recommendManhuaArtStyleFromTopic("都市霸总职场情感");
const xian = recommendManhuaArtStyleFromTopic("仙侠修仙权谋");
if (urban.artStyleId !== "photoreal" || xian.artStyleId !== "cg_drama") {
  bad("题材→画风推荐", `${urban.artStyleId}/${xian.artStyleId}`);
} else ok("题材→画风推荐");

const leads = recommendManhuaCharactersFromTopic("女主权谋翻盘");
if (!leads.femaleId || !leads.maleId) bad("题材→男女主推荐");
else ok(`题材→男女主推荐 ${leads.femaleId}/${leads.maleId}`);

let coupleOk = true;
for (const pack of MANHUA_COUPLE_PACKS) {
  const f = getManhuaCharacterById(pack.femaleId);
  const m = getManhuaCharacterById(pack.maleId);
  if (!f || f.gender !== "female" || !m || m.gender !== "male") {
    coupleOk = false;
    bad(`套组 id 合法 ${pack.id}`);
  }
}
if (coupleOk) ok(`男女套组 ${MANHUA_COUPLE_PACKS.length} 组 id 均合法`);

const coldPack = MANHUA_TEMPERAMENT_PACKS.find((p) => p.id === "cold_elite");
const coldHits = MANHUA_CHARACTER_ASSET_LIBRARY.filter((c) => characterMatchesTemperamentPack(c, coldPack));
if (!coldPack || coldHits.length < 3) bad("气质组合清冷精英有命中");
else ok(`气质组合清冷精英命中 ${coldHits.length}`);

const favJson = serializeManhuaFavoriteIds(["char_f_01", "char_m_02", "nope"]);
const favParsed = parseManhuaFavoriteIds(favJson);
if (favParsed.length !== 2 || !favParsed.includes("char_f_01")) bad("收藏序列化往返");
else ok("收藏序列化往返");

const coupleJson = serializeManhuaCoupleSelection({
  femaleId: "char_f_01",
  maleId: "char_m_02",
  artStyleId: "photoreal",
});
const coupleParsed = parseManhuaCoupleSelection(coupleJson);
if (
  !coupleParsed ||
  coupleParsed.femaleId !== "char_f_01" ||
  coupleParsed.maleId !== "char_m_02" ||
  coupleParsed.artStyleId !== "photoreal"
) {
  bad("双人选型序列化往返");
} else ok("双人选型序列化往返");

if (failed) {
  console.error(`\n验收失败：${failed} 项`);
  process.exit(1);
}
console.log("\n零 token 静态验收通过。UI 请按分支说明肉眼点一遍，勿点「运行」生图/工厂。");
