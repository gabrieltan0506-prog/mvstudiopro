// ─── 更新日志数据（仅展示用户可感知的功能更新）────────────────────
// 【跑马灯专用】维护此阵列即可：首页 `HomeUpdateTicker` 会自动滚动显示全部条目；
// 不需在 Hero / HomeFeatureCarousel 重复贴同一段文字。
//
// 政策（依产品约定调整）：
// - 只保留「最近两个发版日」的条目 + 历史精选一则；旧日请删除或移入内部文档
export const HOME_CHANGELOG_UPDATES = [
  // —— 2026 年 8 月：最近两日 ——
  {
    date: "08/12",
    tag: "新功能",
    text: "逐镜拆片表上线 — 选题扩写自动附七栏分镜表（台词/景别/运镜逐镜落表），一键复制照着拍",
  },
  {
    date: "08/12",
    tag: "新功能",
    text: "首页新增「平台创作 · 一人全链路」专区 — 选题、文案、拆片、图文卡一条流水线",
  },
  {
    date: "08/11",
    tag: "新功能",
    text: "参考图去字双入口 — 免费裁字 + AI 智能去字，设定图更干净",
  },
  {
    date: "08/11",
    tag: "优化",
    text: "爆款学习零门槛入库 — 学 1 集即出草版总分析；漫剧画布四柱排布与顶栏简洁模式，老存档自动迁移",
  },
  // —— 精选一则 ——
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
