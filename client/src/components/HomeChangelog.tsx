// ─── 更新日志数据（仅展示用户可感知的功能更新）────────────────────
// 顺序：五月（新→旧）在前，四月整块在后；跑马灯与平台页轮播共用。
export const HOME_CHANGELOG_UPDATES = [
  // —— 2026 年 5 月（至 05/08，对应已合并 PR 摘要）——
  { date: "05/08", tag: "新功能", text: "GPT-IMAGE-2 主路径生图（平台封面 / 分镜 / 笔记）" },
  { date: "05/08", tag: "优化", text: "小红书 2×4 八格 · Vertex 2K 兜底 · 与主路径同一套 prompt" },
  { date: "05/08", tag: "优化", text: "小红书宽幅合成 24 积分，文案与退款提示对齐" },
  { date: "05/08", tag: "优化", text: "翻译 prompt 放宽上限，优先保生图成功率" },
  { date: "05/07", tag: "优化", text: "平台任务 Fly 队列 + Stage2 轮询，502 退避重试" },
  { date: "05/06", tag: "优化", text: "平台视觉翻译改 GPT 5.4，生图管线加固" },
  { date: "05/05", tag: "修复", text: "选题生图 job 凭证与回写链路" },
  // —— 2026 年 4 月 ——
  { date: "04/26", tag: "新功能", text: "语音输入上线 — 说话即可输入提示词，支持中文识别，告别手动打字" },
  { date: "04/26", tag: "新功能", text: "我的作品 — 每次分析自动生成专属查看页，附带复制链接功能" },
  { date: "04/26", tag: "新功能", text: "内测邀请码申请表上线，填写用途与联系方式即可提交申请" },
  { date: "04/25", tag: "优化", text: "兑换邀请码后积分实时刷新，不再需要重新登录" },
  { date: "04/25", tag: "优化", text: "首页全面焕新，聚焦四大核心功能亮点，简洁直达" },
  { date: "04/24", tag: "修复", text: "验证邮件稳定送达，登录体验全面优化" },
  { date: "04/24", tag: "新功能", text: "我的作品页面上线，所有分析记录一览无余" },
  { date: "04/24", tag: "优化", text: "分析报告展示升级，核心洞察更突出，视觉更清晰" },
] as const;

/** 平台页等功能区：取近 10 条更新轮播 */
export const PLATFORM_RECENT_UPDATES = HOME_CHANGELOG_UPDATES.slice(0, 10);

export const HOME_UPDATE_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  新功能: { bg: "rgba(167,139,250,0.15)", text: "#c4b5fd" },
  修复:   { bg: "rgba(52,211,153,0.12)",  text: "#6ee7b7" },
  优化:   { bg: "rgba(56,189,248,0.12)",  text: "#7dd3fc" },
  安全:   { bg: "rgba(251,146,60,0.12)",  text: "#fdba74" },
};
