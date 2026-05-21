/**
 * Gemini 模型白名单探针（读取 .env.local / .env 的 GEMINI_API_KEY）
 * 用法：pnpm run gemini:monitor
 */
import { config } from "dotenv";
import { runModelInspectionPipeline } from "../server/services/geminiModelMonitor";

config({ path: ".env.local" });
config({ path: ".env" });

const result = await runModelInspectionPipeline();

if (!result.ok) {
  process.exit(1);
}
if (result.alert) {
  process.exit(2);
}
