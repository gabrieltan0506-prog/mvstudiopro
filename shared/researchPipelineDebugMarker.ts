/** 竞品调研失败时附于 Error.message 末尾，供 /research Debug 解析 */
export const RESEARCH_PIPELINE_DEBUG_MARKER = "\n<<RESEARCH_PIPELINE_JSON>>\n";

export type ResearchPipelineDebugStep = {
  at: string;
  phase: string;
  status: "ok" | "start" | "warn" | "fail";
  detail?: string;
};
