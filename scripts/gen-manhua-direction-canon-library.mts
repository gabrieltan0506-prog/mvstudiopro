/**
 * 从蒸馏产物目录生成导演卡库快照（去名）。
 * 用法：npx tsx scripts/gen-manhua-direction-canon-library.mts /path/to/directors
 * 只收「卡级准入」通过的卡（≥2 条独立正式规律）；未过的卡在 stderr 列出，不进快照。
 * 硬判：任何规律/失效条件/反对拍法里出现导演名或《作品名》即生成失败——名字只能留在蒸馏目录，不进代码。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseManhuaDirectionSkillMarkdown } from "../shared/manhuaDirectionSkillParse.js";
import { manhuaDirectionCardIsProductionReady, type ManhuaDirectionCard } from "../shared/manhuaDirectionCanon.js";

const root = process.argv[2];
if (!root || !existsSync(root)) {
  console.error("用法：npx tsx scripts/gen-manhua-direction-canon-library.mts <directors目录>");
  process.exit(2);
}
const out = join(process.cwd(), "shared/manhuaDirectionCanonLibrary.generated.ts");
const cards: ManhuaDirectionCard[] = [];
const rejected: string[] = [];
for (const slug of readdirSync(root).sort()) {
  const file = join(root, slug, "SKILL.md");
  if (!existsSync(file)) continue;
  const md = readFileSync(file, "utf8");
  const { card, skipped } = parseManhuaDirectionSkillMarkdown(md, { slug });
  if (!manhuaDirectionCardIsProductionReady(card)) {
    rejected.push(`${slug}（${card.id}）：正式规律不足 2 条，research_only`);
    continue;
  }
  // 去名硬判：人名 + 《作品名》+ 英文作品名（provenance 里的 title 字段）
  const names = new Set<string>();
  const person = card.internal?.personName || "";
  if (person) {
    names.add(person);
    for (const part of person.split(/\s+/)) if (part.length >= 3) names.add(part);
  }
  for (const m of md.matchAll(/《([^》]{2,40})》/g)) names.add(m[1]);
  const prov = join(root, slug, "provenance.json");
  if (existsSync(prov)) {
    for (const m of readFileSync(prov, "utf8").matchAll(/"(?:title|work|film)"\s*:\s*"([^"]{3,60})"/g)) names.add(m[1]);
  }
  const texts = [
    ...card.rules.filter((r) => r.status !== "research_only").flatMap((r) => [r.titleZh, r.ruleZh, r.whyZh || "", r.predictZh || "", r.failZh || ""]),
    ...(card.avoidZh || []),
    card.labelZh,
  ];
  const leaks = [...names].filter((n) => texts.some((t) => t.includes(n)));
  if (leaks.length) {
    console.error(`${slug}：生产文本泄漏来源名 → ${leaks.join("、")}`);
    process.exit(1);
  }
  if (skipped.length) console.error(`${slug}：跳过 ${skipped.join("；")}`);
  const { internal: _internal, ...rest } = card;
  // 仅研究的规律不进代码快照：它们永远不进生产，也是来源名最容易残留的地方
  // 导演名/作品名/目录 slug 一律不进代码快照；溯源只留在蒸馏目录
  cards.push({ ...rest, rules: card.rules.filter((r) => r.status !== "research_only") });
}
const body = [
  "// 由 scripts/gen-manhua-direction-canon-library.mts 生成，勿手改。",
  `// 生成时间：${new Date().toISOString().slice(0, 10)}；来源：蒸馏目录 directors/<slug>/SKILL.md（导演名与作品名不进本文件）。`,
  'import type { ManhuaDirectionCard } from "./manhuaDirectionCanon.js";',
  "",
  `export const MANHUA_DIRECTION_CARDS_GENERATED: ManhuaDirectionCard[] = ${JSON.stringify(cards, null, 2)};`,
  "",
].join("\n");
writeFileSync(out, body);
console.error(`写入 ${out}：${cards.length} 张卡；未入库 ${rejected.length} 张${rejected.length ? "\n  " + rejected.join("\n  ") : ""}`);
