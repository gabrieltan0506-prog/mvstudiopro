# MV Studio Pro — Stripe 支付接入與 fal.ai Hunyuan3D 部署指南

**作者：Manus AI**
**日期：2026 年 2 月 19 日**

---

## 一、Stripe 支付接入時間線評估

### 1.1 總體時間預估

Stripe 支付接入是一個相對成熟的流程。根據 Stripe 官方文檔及開發者社區的經驗，對於已有後端架構的 SaaS 應用，整體接入時間通常在 **3-5 個工作天**內可完成 [1]。MV Studio Pro 已具備完整的後端架構（Express + tRPC + PostgreSQL），且已有 `server/routers/payment.ts` 的基礎框架，因此實際開發時間可進一步壓縮。

| 階段 | 預估時間 | 說明 |
|------|---------|------|
| Stripe 帳戶註冊與驗證 | 1-2 小時 | 需要公司資料、銀行帳戶、身份驗證 |
| Dashboard 配置產品與價格 | 1-2 小時 | 創建學生半年版、一年版、Pro 版等產品 |
| 後端 Webhook + Checkout 集成 | 1-2 天 | Stripe Checkout Session、Webhook 處理 |
| 前端支付流程 UI | 1 天 | 跳轉 Checkout、支付成功回調頁面 |
| 微信支付 / 支付寶啟用與測試 | 1-3 天 | 需要 Stripe 審核（見下文） |
| 端到端測試 | 0.5 天 | 測試模式全流程驗證 |
| **合計** | **3-5 個工作天** | 可在七天倒計時內完成 |

### 1.2 關鍵前置條件

在開始開發之前，需要完成以下準備工作：

1. **Stripe 帳戶**：前往 [stripe.com](https://stripe.com) 註冊帳戶。需要提供公司名稱、地址、銀行帳戶資訊。如果使用香港公司註冊，Stripe 支持 HKD 結算。
2. **Stripe API Keys**：在 Dashboard → Developers → API Keys 中獲取 `STRIPE_SECRET_KEY` 和 `STRIPE_PUBLISHABLE_KEY`。
3. **Webhook Endpoint**：配置 Webhook URL 指向 `https://your-domain.com/api/stripe/webhook`。

### 1.3 建議的技術方案

考慮到 MV Studio Pro 的訂閱模式（學生半年版 $20、一年版 $38、Pro 版等），建議採用 **Stripe Checkout + Webhooks** 方案，而非自建支付表單。原因如下：

Stripe Checkout 是 Stripe 提供的預建支付頁面，支持信用卡、Apple Pay、Google Pay、微信支付、支付寶等多種支付方式，且自動處理 PCI 合規、3D Secure 驗證等安全需求。開發者只需在後端創建 Checkout Session，將用戶重定向到 Stripe 託管的支付頁面，支付完成後通過 Webhook 接收通知並更新訂閱狀態即可 [2]。

---

## 二、微信支付與支付寶：ICP 備案問題

### 2.1 核心結論：不需要 ICP 備案

**通過 Stripe 接入微信支付和支付寶屬於跨境支付（Cross-border Payment），不需要 ICP 備案。** 這是因為支付流程由 Stripe 作為中間方處理，用戶的支付請求從 Stripe 的支付頁面發起，而非從你的中國境內伺服器發起 [3]。

| 場景 | 是否需要 ICP 備案 |
|------|------------------|
| 通過 Stripe 接入微信支付 / 支付寶（跨境） | **不需要** |
| 直接接入微信支付商戶平台（境內） | 需要中國實體 + ICP |
| 直接接入支付寶當面付（境內） | 需要中國實體 + ICP |
| 網站託管在中國境內伺服器 | 需要 ICP 備案 |
| 網站託管在海外（如 AWS、Vercel） | 不需要 ICP |

### 2.2 Stripe 微信支付 / 支付寶的具體要求

根據 Stripe 官方文檔 [4] [5]，通過 Stripe 接入微信支付和支付寶的要求如下：

**不需要的東西：**
- 不需要中國公司實體
- 不需要中國銀行帳戶
- 不需要中國手機號碼或身份證
- 不需要 ICP 備案

**需要的東西：**
- 一個有效的 Stripe 帳戶（美國、香港、新加坡等均可）
- 在 Stripe Dashboard 中啟用 WeChat Pay 和 Alipay
- 通過 Stripe 的業務類型審核（1-3 天）

### 2.3 重要限制：不支持自動續費

微信支付和支付寶通過 Stripe 接入時，**不支持 Recurring Payments（自動續費訂閱）**，只能做一次性支付 [4]。這意味著學生半年版和一年版的訂閱需要設計為「一次性購買 N 個月的使用權」，而非自動扣款的訂閱模式。

**建議的解決方案：**

對於微信支付 / 支付寶用戶，將訂閱設計為一次性支付。用戶支付 $20 即獲得 6 個月使用權，支付 $38 即獲得 12 個月使用權。到期前 7 天推送提醒，引導用戶手動續費。對於信用卡用戶，則可以使用 Stripe 的標準 Subscription 模式實現自動續費。

### 2.4 費率對比

| 支付方式 | Stripe 手續費 | 結算時間 |
|---------|-------------|---------|
| 信用卡（國際） | 2.9% + $0.30 | 2 個工作天 |
| 信用卡（香港帳戶） | 2.7% + HK$2.35 | 2 個工作天 |
| 微信支付 | 2.9% + $0.30 | 標準結算 |
| 支付寶 | 2.9% + $0.30 | 標準結算 |

---

## 三、fal.ai Hunyuan3D API 部署詳細步驟

### 3.1 概述

fal.ai 提供了 Hunyuan3D 的多個版本，用於將 2D 圖片轉換為 3D 模型。MV Studio Pro 的「偶像轉 3D」功能將使用此 API。以下是完整的部署步驟。

### 3.2 第一步：註冊 fal.ai 帳戶

1. 前往 [fal.ai](https://fal.ai)，點擊右上角 **Sign-up**。
2. 可使用 GitHub 或 Google 帳戶快速註冊。
3. 註冊完成後，進入 Dashboard。

### 3.3 第二步：創建 API Key

1. 登入後，前往 [fal.ai Dashboard → Keys](https://fal.ai/dashboard/keys)。
2. 點擊 **Create Key**。
3. 選擇 Scope 為 **ADMIN**（如果是團隊帳戶，確保在左上角選擇正確的團隊）。
4. 複製生成的 API Key（格式類似 `fal-xxxxxxxxxxxxxxxx`）。
5. **妥善保管此 Key，不要暴露在前端代碼中** [6]。

### 3.4 第三步：充值帳戶

1. 前往 [fal.ai Dashboard → Billing](https://fal.ai/dashboard/billing)。
2. 添加信用卡或選擇預付費方案。
3. fal.ai 採用按量計費模式，建議初期充值 $50-100 用於測試。

### 3.5 第四步：在 MV Studio Pro 中配置環境變量

在項目中設置 `FAL_KEY` 環境變量。這個 Key 只在伺服器端使用，絕不暴露給前端：

```bash
# 在 .env 文件中添加
FAL_KEY=fal-xxxxxxxxxxxxxxxx
```

### 3.6 第五步：安裝 fal.ai Client SDK

在項目中安裝 Node.js SDK：

```bash
pnpm add @fal-ai/client
```

### 3.7 第六步：後端集成代碼

在 `server/routers/` 中創建 Hunyuan3D 路由。以下是核心集成代碼：

```typescript
import { fal } from "@fal-ai/client";

// 配置 API Key（從環境變量讀取）
fal.config({
  credentials: process.env.FAL_KEY,
});

// 調用 Hunyuan3D v3.1 Rapid（推薦，性價比最高）
async function convertImageTo3D(imageUrl: string) {
  const result = await fal.subscribe("fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d", {
    input: {
      input_image_url: imageUrl,
      num_inference_steps: 50,
      guidance_scale: 7.5,
      octree_resolution: 256,
      textured_mesh: true, // 生成帶紋理的模型（價格 ×3）
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs.map((log) => log.message).forEach(console.log);
      }
    },
  });

  return {
    modelUrl: result.data.model_mesh.url,    // 3D 模型文件 URL（.glb 格式）
    fileName: result.data.model_mesh.file_name,
    fileSize: result.data.model_mesh.file_size,
    seed: result.data.seed,
  };
}
```

### 3.8 第七步：AI Avatar 集成（同樣使用 fal.ai）

AI Avatar 功能使用 Kling AI Avatar v2 模型：

```typescript
// 調用 Kling AI Avatar v2 Standard
async function generateAIAvatar(
  imageUrl: string,
  audioUrl: string,
  prompt: string
) {
  const result = await fal.subscribe("fal-ai/kling-video/ai-avatar/v2/standard", {
    input: {
      face_image_url: imageUrl,
      audio_url: audioUrl,
      prompt: prompt,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs.map((log) => log.message).forEach(console.log);
      }
    },
  });

  return {
    videoUrl: result.data.video.url,
    duration: result.data.video.duration,
  };
}
```

### 3.9 可用模型與定價一覽

| 模型 | 用途 | 價格 | 推薦場景 |
|------|------|------|---------|
| `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` | 圖片轉 3D（快速） | $0.225/次 | 日常使用，性價比最高 |
| `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` | 圖片轉 3D（高質量） | $0.375/次 | Pro 用戶 |
| `fal-ai/hunyuan3d-v3/text-to-3d` | 文字轉 3D | $0.375/次 | 創意探索 |
| `fal-ai/hunyuan-3d/v3.1/smart-topology` | 智能拓撲優化 | $0.75/次 | 專業級輸出 |
| `fal-ai/kling-video/ai-avatar/v2/standard` | AI 數字人 | $0.0562/秒 | 虛擬偶像視頻 |
| `fal-ai/kling-video/ai-avatar/v2/pro` | AI 數字人（Pro） | $0.115/秒 | 高質量數字人 |

### 3.10 第八步：測試驗證

1. 使用 fal.ai Playground 先手動測試模型效果（免費預覽）。
2. 在開發環境中調用 API，確認返回的 .glb 文件可正常加載。
3. 測試不同分辨率和參數對生成質量的影響。
4. 確認 Webhook 或輪詢機制正常工作（3D 生成通常需要 30-120 秒）。

---

## 四、API 接入優先級與決策總結

| API | 提供方 | 決策 | 狀態 |
|-----|-------|------|------|
| Kling 3.0 視頻生成 | Kling 官方 API | 使用官方 API（成本更低） | 今天不開通，等上線後開通 |
| Kling Lip-Sync | Kling 官方 API | 使用官方 API | 同上 |
| Kling 2.6 Motion Control | Kling 官方 API | 使用官方 API | 同上 |
| Hunyuan3D（2D 轉 3D） | fal.ai | 使用 fal.ai（官方無此模型） | 可立即部署 |
| AI Avatar 數字人 | fal.ai | 使用 fal.ai（獨家提供） | 可立即部署 |
| Stripe 支付 | Stripe | 信用卡 + 微信 + 支付寶 | 七天內完成 |

---

## 參考資料

[1]: https://www.reddit.com/r/SaaS/comments/16vntj7/ "Reddit - How long does it take to integrate a payment processor"
[2]: https://docs.stripe.com/get-started/use-cases/saas-subscriptions "Stripe - Sell subscriptions as a SaaS startup"
[3]: https://nanjingmarketinggroup.com/blog/stripe-payments-via-alipay-and-wechat-pay "NMG - How to Use Stripe to Accept Payments via Alipay and WeChat Pay"
[4]: https://docs.stripe.com/payments/wechat-pay "Stripe - WeChat Pay payments"
[5]: https://docs.stripe.com/payments/alipay "Stripe - Alipay payments"
[6]: https://docs.fal.ai/serverless/getting-started/installation "fal.ai - Installation & Setup"
