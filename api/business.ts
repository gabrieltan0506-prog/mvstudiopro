import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analyzeVideo } from "../server/business/videoAnalyzer.js";
import { getTrends } from "../server/business/trendCollector.js";
import { buildInsight } from "../server/business/insightEngine.js";
import { buildGrowthPlan } from "../server/business/growthPlanner.js";
import { buildReport } from "../server/business/reportBuilder.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const op = String(req.query.op || "").trim();

  if (op === "analyze") {
    const result = await analyzeVideo({});
    const report = await buildReport(result);
    return res.status(200).json({ ok: true, result, report });
  }

  if (op === "trends") {
    const trends = await getTrends();
    return res.status(200).json({ ok: true, trends });
  }

  if (op === "insight") {
    const insight = await buildInsight({});
    return res.status(200).json({ ok: true, insight });
  }

  if (op === "plan") {
    const plan = await buildGrowthPlan("travel");
    return res.status(200).json({ ok: true, plan });
  }

  return res.status(400).json({ ok: false, error: "invalid op" });
}
