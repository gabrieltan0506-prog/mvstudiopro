// ─── 更新日志数据（仅展示用户可感知的功能更新）────────────────────
// 【跑马灯专用】维护此阵列即可：首页 `HomeUpdateTicker` 会自动滚动显示全部条目；
// 不需在 Hero / HomeFeatureCarousel 重复贴同一段文字。
//
// 政策（依产品约定调整）：
// - 四月：仅保留一则最重要的摘要
// - 五月：仅保留「最近两个发版日」的条目（例如 05/15、05/16）；旧日请删除或移入内部文档
export const HOME_CHANGELOG_UPDATES = [
  // —— 2026 年 5 月：最近两日 ——
  {
    date: "05/16",
    tag: "新功能",
    text: "上线旗舰 AI 高清生图与新一代影片生成",
  },
  {
    date: "05/16",
    tag: "新功能",
    text: "首页主视觉对齐六大主打能力、快捷链至智库；全站环境底图与天气背景统一呈现",
  },
  {
    date: "05/16",
    tag: "优化",
    text: "企业定制入口暂收敛；创作捷径新增文字生图与图生视频能力",
  },
  {
    date: "05/15",
    tag: "优化",
    text: "大师级电影工作流：生图流水线纪录统一为上海时区；选题单帧封面的深度研究步骤已恢复",
  },
  {
    date: "05/15",
    tag: "优化",
    text: "大师电影八格套装：深度研究不会再被略过；新任务排队与状态提示更清楚",
  },
  // —— 2026 年 4 月：精选一则 ——
  {
    date: "04/28",
    tag: "新功能",
    text: "万能素材解析引擎 — 抖音 · 快手 · 小红书 · B 站本地化解析，URL 一键原画无水印下载",
  },
] as const;

/** 平台页等功能区：取近 10 条更新轮播（目前与跑马灯同源） */
export const PLATFORM_RECENT_UPDATES = HOME_CHANGELOG_UPDATES.slice(0, 10);

export const HOME_UPDATE_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  新功能: { bg: "rgba(167,139,250,0.15)", text: "#c4b5fd" },
  修复: { bg: "rgba(52,211,153,0.12)", text: "#6ee7b7" },
  优化: { bg: "rgba(56,189,248,0.12)", text: "#7dd3fc" },
  安全: { bg: "rgba(251,146,60,0.12)", text: "#fdba74" },
};
