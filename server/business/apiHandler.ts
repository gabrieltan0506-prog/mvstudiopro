import type { Request, Response } from "express";
import { analyzeVideo } from "./videoAnalyzer.js";
import { getTrends } from "./trendCollector.js";
import { buildInsight } from "./insightEngine.js";
import { buildGrowthPlan } from "./growthPlanner.js";
import { buildReport } from "./reportBuilder.js";

export async function businessHandler(req: Request, res: Response) {
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
