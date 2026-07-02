/**
 * 本地烟测：自定义文案深度优化（Evolink GPT-5.5，可能产生费用）。
 * 用法：pnpm exec tsx scripts/test-optimize-custom-copy.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { optimizeCustomCopy } = await import("../server/services/platformOptimizeCustomCopy.js");

const sample = `情绪免疫力，不是让你没有情绪，而是让你在情绪来的时候，还能把东坡肉、荔枝和好心情先留给妻子。
2. 我是男德学院院长，哈佛医学博士，擅长把古典文学与心血管健康结合。
3. 希望在小红书开一门课，讲苏轼式的生活韧性与现代医学。`;

if (!String(process.env.EVOLINK_API_KEY || "").trim()) {
  console.error("SKIP: 需要 EVOLINK_API_KEY（.env.local 或 Fly secret）才能跑 live 烟测");
  process.exit(1);
}

try {
  const t0 = Date.now();
  const result = await optimizeCustomCopy({
    sourceText: sample,
    optimizationBrief: "优化封面标题与分镜口播",
  });
  console.log("OK ms=", Date.now() - t0);
  console.log("summary:", result.summary.slice(0, 120));
  console.log("markdown len:", result.optimizedMarkdown.length);
  console.log("titles:", result.titles.slice(0, 2));
} catch (e) {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
}
