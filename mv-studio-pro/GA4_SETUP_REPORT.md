# Google Analytics 4 設定報告

**網站：** MV Studio Pro  
**網址：** https://www.mvstudiopro.com  
**測量 ID：** G-XW7BG9X2QB  
**整合日期：** 2026-02-15  
**狀態：** ✅ 已上線運行

---

## 一、整合概述

Google Analytics 4 已成功整合到 MV Studio Pro 網站的所有頁面中。GA4 追蹤代碼通過動態注入 `gtag.js` 腳本的方式載入，並在每次路由切換時自動發送頁面瀏覽事件，完整支持 SPA（單頁應用）架構。

---

## 二、技術實作細節

### 2.1 檔案結構

| 檔案 | 用途 |
|------|------|
| `lib/analytics.ts` | GA4 核心模組：初始化、頁面追蹤、自訂事件追蹤 |
| `app/_layout.tsx` | 根佈局：GA4 初始化 + 路由變更追蹤 |
| `components/guestbook-section.tsx` | 留言表單：提交成功時觸發表單追蹤事件 |

### 2.2 追蹤功能

| 功能 | 事件名稱 | 觸發時機 |
|------|----------|----------|
| 頁面瀏覽 | `page_view` | 每次路由切換時自動觸發 |
| 表單提交 | `form_submission` | 訪客留言表單提交成功時 |
| 功能點擊 | `feature_click` | 可用於追蹤快捷功能卡片點擊（已預留接口） |
| 自訂事件 | 自訂名稱 | 通過 `trackEvent()` 函數可追蹤任意自訂事件 |

### 2.3 追蹤的頁面路由

| 路由路徑 | 頁面名稱 |
|----------|----------|
| `/` | 首頁 |
| `/analyze` | MV 分析 |
| `/idol` | 虛擬偶像 |
| `/effects` | 視覺特效 |
| `/publish` | 發布策略 |
| `/highlights` | 精華 MV |
| `/mv-compare` | MV 對比 |
| `/mv-gallery` | MV 精選集 |
| `/intro-animation` | 開場動畫 |
| `/theme-lab` | 主題實驗室 |

### 2.4 平台兼容性

GA4 追蹤代碼僅在 Web 平台上運行，不會影響 iOS 或 Android 原生應用的性能。所有追蹤函數在非 Web 平台上會自動跳過執行。

---

## 三、生產環境驗證結果

| 驗證項目 | 結果 |
|----------|------|
| gtag.js 腳本載入 | ✅ `https://www.googletagmanager.com/gtag/js?id=G-XW7BG9X2QB` |
| `gtag()` 函數可用 | ✅ `typeof window.gtag === 'function'` |
| `dataLayer` 初始化 | ✅ 已初始化，包含 3 個條目 |
| 測量 ID 正確 | ✅ `G-XW7BG9X2QB` |
| 頁面瀏覽事件 | ✅ 路由切換時自動發送 |
| SPA 路由追蹤 | ✅ 使用 `usePathname()` 監聽路由變更 |

---

## 四、可用的追蹤 API

開發者可在任何組件中使用以下函數進行自訂追蹤：

```typescript
import { trackEvent, trackPageView, trackFeatureClick, trackFormSubmission } from "@/lib/analytics";

// 追蹤自訂事件
trackEvent("button_click", { button_name: "get_started" });

// 追蹤功能卡片點擊
trackFeatureClick("MV 分析");

// 追蹤表單提交
trackFormSubmission("contact_form");

// 手動追蹤頁面瀏覽
trackPageView("/custom-page", "自訂頁面標題");
```

---

## 五、查看數據

1. 前往 [Google Analytics](https://analytics.google.com) 登入
2. 選擇 **MV Studio Pro** 資源
3. **即時報告**：左側選單 → 報告 → 即時，可立即看到當前在線用戶
4. **流量報告**：報告 → 獲客 → 流量獲取，查看訪客來源
5. **頁面報告**：報告 → 參與 → 頁面和畫面，查看各頁面瀏覽量
6. **事件報告**：報告 → 參與 → 事件，查看自訂事件數據

> **注意：** GA4 數據通常需要 24-48 小時才會完整顯示在標準報告中。即時報告可在幾分鐘內看到數據。

---

## 六、建議的後續優化

1. **設置轉換目標**：在 GA4 中將 `form_submission` 事件標記為轉換，追蹤留言表單的轉換率。
2. **啟用增強型衡量**：在 GA4 資源設定中開啟「增強型衡量」，自動追蹤滾動、外部連結點擊、網站搜尋等行為。
3. **連接 Google Search Console**：在 GA4 管理 → 產品連結中連接 Search Console，合併查看搜尋和流量數據。
4. **設置自訂維度**：為不同功能模組（MV 分析、虛擬偶像等）設置自訂維度，深入分析用戶使用偏好。
