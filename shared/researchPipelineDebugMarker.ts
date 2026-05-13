/** 竞品调研失败时附于 Error.message 末尾，供 /research Debug 解析 */
export const RESEARCH_PIPELINE_DEBUG_MARKER = "\n<<RESEARCH_PIPELINE_JSON>>\n";

export type ResearchPipelineDebugStep = {
  at: string;
  /** 逻辑阶段：validate_input | platform_context | stage1_scan | stage2_prescription | parse_strategy_json | fly_backup */
  phase: string;
  status: "ok" | "start" | "warn" | "fail";
  /** 单行摘要（适合列表展示） */
  detail?: string;
  /** 完整错误：堆栈 / API 原文等，仅在 Debug 面板展开 */
  errorDetail?: string;
};
