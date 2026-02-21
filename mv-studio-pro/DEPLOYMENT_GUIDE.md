# MV Studio Pro 生產環境部署指南

**作者：** Manus AI  
**日期：** 2026 年 2 月 15 日  
**版本：** 1.0

---

## 概述

本指南提供將 MV Studio Pro 從開發環境部署到生產環境的完整步驟。MV Studio Pro 是一個基於 Expo Web 的靜態網站應用，構建後產出純 HTML/CSS/JS 靜態文件，可部署到任何靜態託管平台。本文涵蓋 **Vercel** 和 **Netlify** 兩種主流部署方案，以及自訂域名 `mvstudiopro.com` 的綁定與 SSL 配置。

---

## 前置條件

在開始部署之前，請確認以下條件已滿足：

| 項目 | 要求 | 狀態 |
|------|------|------|
| GitHub 倉庫 | `gabrieltan0506-prog/mv-studio-pro`（已推送） | ✅ 已完成 |
| 構建配置 | `vercel.json` 和 `netlify.toml` 已添加 | ✅ 已完成 |
| 靜態文件構建 | `npx expo export --platform web` 可正常執行 | ✅ 已驗證 |
| 域名所有權 | 擁有 `mvstudiopro.com` 域名的 DNS 管理權限 | 需確認 |
| 帳號註冊 | Vercel 或 Netlify 帳號（支持 GitHub 登入） | 需操作 |

---

## 方案一：Vercel 部署（推薦）

Vercel 是 Next.js 的母公司，對前端靜態網站提供極佳的全球 CDN 加速和自動 HTTPS 支持。免費方案即可滿足 MV Studio Pro 的需求。

### 步驟 1：連接 GitHub 倉庫

1. 前往 [vercel.com](https://vercel.com) 並使用 GitHub 帳號登入。
2. 點擊 **「Add New → Project」**。
3. 在 **「Import Git Repository」** 列表中找到 `mv-studio-pro`，點擊 **「Import」**。

### 步驟 2：配置構建設定

Vercel 會自動讀取倉庫根目錄的 `vercel.json`，以下設定已預先配置好：

| 配置項 | 值 | 說明 |
|--------|-----|------|
| Build Command | `npx expo export --platform web` | Expo 靜態導出命令 |
| Output Directory | `dist` | 構建產出目錄 |
| Install Command | `pnpm install` | 依賴安裝命令 |
| Framework Preset | `Other` | 不使用框架預設 |

如果 Vercel 未自動識別，請在 **「Build & Development Settings」** 中手動填入上述值。確認後點擊 **「Deploy」**，等待構建完成（約 2-3 分鐘）。

### 步驟 3：綁定自訂域名

部署成功後，進入項目的 **「Settings → Domains」** 頁面：

1. 在輸入框中填入 `mvstudiopro.com`，點擊 **「Add」**。
2. Vercel 會提示您需要配置 DNS 記錄。建議同時添加根域名和 www 子域名。

在您的域名 DNS 管理面板中添加以下記錄：

| 類型 | 名稱 | 值 | TTL |
|------|------|-----|-----|
| A | `@` | `76.76.21.21` | 300 |
| CNAME | `www` | `cname.vercel-dns.com` | 300 |

> **注意：** Vercel 的 A 記錄 IP 地址可能會更新，請以 Vercel 控制台顯示的實際值為準。

DNS 記錄生效後（通常 5-30 分鐘），Vercel 會自動為您的域名配置 **Let's Encrypt SSL 證書**，無需任何額外操作。

### 步驟 4：驗證部署

部署完成後，您可以通過以下 URL 訪問網站：

- **Vercel 預設域名：** `https://mv-studio-pro.vercel.app`
- **自訂域名：** `https://mvstudiopro.com`
- **www 子域名：** `https://www.mvstudiopro.com`（自動重定向到根域名）

---

## 方案二：Netlify 部署

Netlify 同樣提供優秀的靜態網站託管服務，免費方案包含每月 100GB 帶寬和自動 HTTPS。

### 步驟 1：連接 GitHub 倉庫

1. 前往 [app.netlify.com](https://app.netlify.com) 並使用 GitHub 帳號登入。
2. 點擊 **「Add new site → Import an existing project」**。
3. 選擇 **GitHub**，授權後找到 `mv-studio-pro` 倉庫。

### 步驟 2：配置構建設定

Netlify 會自動讀取 `netlify.toml`，以下設定已預先配置：

| 配置項 | 值 |
|--------|-----|
| Build Command | `npx expo export --platform web` |
| Publish Directory | `dist` |
| Node Version | 22 |

確認設定後點擊 **「Deploy site」**。

### 步驟 3：綁定自訂域名

部署成功後，進入 **「Site settings → Domain management → Custom domains」**：

1. 點擊 **「Add custom domain」**，填入 `mvstudiopro.com`。
2. Netlify 會要求驗證域名所有權。

在 DNS 管理面板中添加以下記錄：

| 類型 | 名稱 | 值 | TTL |
|------|------|-----|-----|
| A | `@` | `75.2.60.5` | 300 |
| CNAME | `www` | `mv-studio-pro.netlify.app` | 300 |

> **注意：** 建議使用 Netlify DNS 託管域名以獲得最佳性能。在 **「Domain management」** 中選擇 **「Use Netlify DNS」** 可自動完成所有配置。

### 步驟 4：啟用 HTTPS

進入 **「Site settings → Domain management → HTTPS」**，點擊 **「Verify DNS configuration」**，然後點擊 **「Provision certificate」**。Netlify 會自動簽發 Let's Encrypt SSL 證書。

---

## 兩種方案對比

| 特性 | Vercel | Netlify |
|------|--------|---------|
| 免費方案帶寬 | 100GB/月 | 100GB/月 |
| 全球 CDN 節點 | Edge Network（全球） | 全球 CDN |
| 自動 HTTPS | ✅ 自動 | ✅ 自動（需手動觸發） |
| 構建時間 | 約 2-3 分鐘 | 約 2-3 分鐘 |
| Git 自動部署 | ✅ Push 即部署 | ✅ Push 即部署 |
| 預覽部署 | ✅ 每個 PR 自動預覽 | ✅ 每個 PR 自動預覽 |
| 自訂域名 | ✅ 免費 | ✅ 免費 |
| 分析面板 | ✅ Web Analytics（免費） | 付費方案 |
| **推薦理由** | CDN 速度快，配置簡單 | 表單處理、函數支持豐富 |

對於 MV Studio Pro 這類純前端靜態網站，**Vercel 是推薦選擇**，因為其 Edge Network 在亞太地區（中國用戶為主）的表現更優，且配置流程更為簡潔。

---

## 自動部署工作流

兩個平台都支持 **Git Push 自動部署**。完成初次部署後，後續的更新流程如下：

```bash
# 1. 在本地修改代碼
# 2. 提交變更
git add -A
git commit -m "更新描述"

# 3. 推送到 GitHub（自動觸發部署）
git push github main
```

每次推送到 `main` 分支後，Vercel/Netlify 會自動拉取最新代碼、執行構建命令、部署到 CDN。整個過程通常在 2-3 分鐘內完成。

---

## 環境變數配置

如果未來需要添加 API 密鑰或其他環境變數，可在部署平台的控制台中設定：

**Vercel：** 進入 **「Settings → Environment Variables」**，添加鍵值對。

**Netlify：** 進入 **「Site settings → Environment variables」**，添加鍵值對。

---

## 常見問題排查

### 構建失敗

如果構建過程中出現錯誤，請檢查以下幾點：確認 `pnpm` 版本與 `package.json` 中的 `packageManager` 欄位一致（`pnpm@9.12.0`）；確認 Node.js 版本為 22.x；檢查構建日誌中的具體錯誤信息。

### 頁面 404 錯誤

Expo Web 使用靜態導出模式，每個路由都有對應的 HTML 文件。如果出現 404，請確認 `vercel.json` 或 `netlify.toml` 中的路由重寫規則是否正確。

### SSL 證書問題

SSL 證書通常在 DNS 記錄生效後 5-30 分鐘內自動簽發。如果超過 1 小時仍未生效，請檢查 DNS 記錄是否正確指向部署平台的 IP 或 CNAME。

### 域名未生效

DNS 傳播通常需要 5 分鐘到 48 小時不等。可使用 [dnschecker.org](https://dnschecker.org) 檢查 DNS 記錄的全球傳播狀態。

---

## 項目資訊

| 項目 | 詳情 |
|------|------|
| GitHub 倉庫 | https://github.com/gabrieltan0506-prog/mv-studio-pro |
| 構建命令 | `npx expo export --platform web` |
| 輸出目錄 | `dist/` |
| 靜態路由數量 | 17 個 |
| 構建產出大小 | 約 19MB |
| 主要技術棧 | Expo SDK 54 + React Native Web + TypeScript |
