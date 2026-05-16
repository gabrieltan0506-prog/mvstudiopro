import React from "react";

// ─── 更新日志数据（仅展示用户可感知的功能更新）────────────────────
// 【跑馬燈專用】維護此陣列即可：首頁 `HomeUpdateTicker` 會自動滾動顯示全部條目；
// 不需在 Hero / HomeFeatureCarousel 重複貼同一段文字。
//
// 政策（依產品約定調整）：
// - 四月：僅保留一則最重要的摘要
// - 五月：僅保留「最近兩個發版日」的條目（例如 05/15、05/16）；舊日請刪除或移入內部文檔
export const HOME_CHANGELOG_UPDATES = [
  // —— 2026 年 5 月：最近兩日 ——
  {
    date: "05/16",
    tag: "新功能",
    text: (
      <span className="flex flex-col items-start gap-1">
        <span>上線旗艦生圖GPT-image-2與</span>
        <span style={{ color: "#ec4899", fontWeight: 800 }}>Seedance 2.0 視頻生成</span>
      </span>
    ),
  },
  {
    date: "05/16",
    tag: "新功能",
    text: "首頁 Hero 對齊六大主打能力、快捷鏈至智庫；全局環境底圖 Ambient（本地圖 + 拉圖腳本，App 層統一掛載）",
  },
  {
    date: "05/16",
    tag: "优化",
    text: "企業定制入口暫收斂（Navbar / 首頁輪播）；創作捷徑新增 /creative 文字生圖與圖生視頻（Gemini Flash 圖 + Seedance 權限）",
  },
  {
    date: "05/15",
    tag: "优化",
    text: "大師電影工作流：平台生圖流水線日誌統一上海時區；選題單幀封面 Deep Research 步驟恢復（PR 547）",
  },
  {
    date: "05/15",
    tag: "优化",
    text: "2×4 套裝 job 不再強制跳過 composite Deep Research；新任務入隊保留 Debug 日誌橫幅",
  },
  // —— 2026 年 4 月：精選一則 ——
  {
    date: "04/28",
    tag: "新功能",
    text: "万能素材解析引擎 — 抖音 · 快手 · 小红书 · B 站本地化解析，URL 一鍵原畫無水印下載",
  },
] as const;

/** 平台页等功能区：取近 10 条更新轮播（目前与跑馬燈同源） */
export const PLATFORM_RECENT_UPDATES = HOME_CHANGELOG_UPDATES.slice(0, 10);

export const HOME_UPDATE_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  新功能: { bg: "rgba(167,139,250,0.15)", text: "#c4b5fd" },
  修复: { bg: "rgba(52,211,153,0.12)", text: "#6ee7b7" },
  优化: { bg: "rgba(56,189,248,0.12)", text: "#7dd3fc" },
  安全: { bg: "rgba(251,146,60,0.12)", text: "#fdba74" },
};
