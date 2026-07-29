/**
 * 道具形制联网核对实测：确认「朝笏」这类器物查得到、且查回来的是形状不是叙事。
 * 用法：pnpm tsx scripts/probe-prop-shape-lookup.mts [道具名 ...]
 */
import "dotenv/config";
import { lookupManhuaPropShapeHintZh } from "../server/services/manhuaPropShapeLookup.js";

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["象牙色朝笏", "朝笏", "漕银账册", "双层密信", "残局棋盘", "火漆母模", "半枚同盟玉扣"];

for (const name of names) {
  const t0 = Date.now();
  const hint = await lookupManhuaPropShapeHintZh(name);
  console.log(
    `\n【${name}】${Date.now() - t0}ms\n${hint || "（查不到 / 已丢弃，提示词将不写形制）"}`,
  );
}
