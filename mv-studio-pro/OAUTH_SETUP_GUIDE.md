# MV Studio Pro - OAuth 配置指南

本指南將教您如何配置 Google OAuth 以支持生產環境域名 mvstudiopro.com。

---

## 問題說明

當您在 mvstudiopro.com 使用 Gmail 登入時，系統會重定向到開發環境的 URL（`3000-xxx.manus.computer`），導致登入失敗。

**原因**：OAuth 回調 URL 配置錯誤，系統使用了開發環境的 URL 而不是生產環境的 URL。

**解決方案**：
1. 修復後端 OAuth 回調 URL 邏輯（✅ 已完成）
2. 在 Vercel 添加 `FRONTEND_URL` 環境變量
3. 在 Google Cloud Console 更新 OAuth 配置

---

## 步驟 1：在 Vercel 添加環境變量

### 1.1 登入 Vercel

1. 訪問 https://vercel.com
2. 選擇您的 `mv-studio-pro` 項目

### 1.2 添加 FRONTEND_URL 環境變量

1. 點擊「Settings」→「Environment Variables」
2. 添加新的環境變量：
   - **Key**：`FRONTEND_URL`
   - **Value**：`https://mvstudiopro.com`
   - **Environment**：選擇「Production」、「Preview」和「Development」
3. 點擊「Save」

### 1.3 重新部署項目

1. 點擊「Deployments」
2. 選擇最新的部署
3. 點擊「Redeploy」按鈕
4. 等待部署完成（約 3-5 分鐘）

---

## 步驟 2：更新 Google OAuth 配置

### 2.1 登入 Google Cloud Console

1. 訪問 https://console.cloud.google.com
2. 登入您的 Google 帳號
3. 選擇您的項目（或創建新項目）

### 2.2 啟用 Google+ API（如果還沒有）

1. 在左側菜單中，點擊「APIs & Services」→「Library」
2. 搜索「Google+ API」
3. 點擊「Enable」

### 2.3 創建 OAuth 2.0 憑證（如果還沒有）

1. 在左側菜單中，點擊「APIs & Services」→「Credentials」
2. 點擊「Create Credentials」→「OAuth client ID」
3. 選擇「Web application」
4. 輸入名稱（例如「MV Studio Pro」）

### 2.4 添加授權的重定向 URI

在「Authorized redirect URIs」部分，添加以下 URI：

```
https://mvstudiopro.com/api/oauth/callback
https://www.mvstudiopro.com/api/oauth/callback
```

**注意**：
- 確保 URI 以 `https://` 開頭（不是 `http://`）
- 確保 URI 路徑為 `/api/oauth/callback`
- 如果您有 www 子域名，也需要添加

### 2.5 保存配置

1. 點擊「Save」
2. 複製「Client ID」和「Client Secret」（稍後會用到）

---

## 步驟 3：在 Vercel 添加 Google OAuth 憑證

### 3.1 添加環境變量

在 Vercel 項目的「Settings」→「Environment Variables」中，添加以下環境變量：

| Key | Value | 說明 |
|-----|-------|------|
| `GOOGLE_CLIENT_ID` | `您的 Google Client ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | `您的 Google Client Secret` | Google OAuth Client Secret |

### 3.2 重新部署項目

1. 點擊「Deployments」
2. 選擇最新的部署
3. 點擊「Redeploy」按鈕
4. 等待部署完成

---

## 步驟 4：測試 OAuth 登入

### 4.1 訪問生產環境

1. 訪問 https://mvstudiopro.com
2. 點擊「使用 Gmail 登入」按鈕

### 4.2 驗證重定向 URL

登入時，檢查瀏覽器地址欄的 URL：

- ✅ **正確**：`https://mvstudiopro.com/oauth/callback?sessionToken=...`
- ❌ **錯誤**：`https://3000-xxx.manus.computer/api/oauth/callback?...`

### 4.3 確認登入成功

登入成功後，您應該能看到：
- 用戶名稱顯示在右上角
- 可以訪問受保護的頁面（例如分鏡生成頁面）

---

## 常見問題

### Q1：為什麼我添加了 FRONTEND_URL 環境變量後還是重定向到開發環境？

**A**：請確保：
1. 環境變量的值是 `https://mvstudiopro.com`（不是 `http://`）
2. 已經重新部署項目（環境變量更改後需要重新部署才能生效）
3. 清除瀏覽器緩存並重新登入

### Q2：Google OAuth 顯示「redirect_uri_mismatch」錯誤怎麼辦？

**A**：這表示 Google Cloud Console 中的「Authorized redirect URIs」配置錯誤。請檢查：
1. URI 是否完全匹配（包括 `https://`、域名和路徑）
2. URI 路徑是否為 `/api/oauth/callback`
3. 是否保存了配置

### Q3：如何查看 OAuth 回調的錯誤日誌？

**A**：在 Vercel 項目頁面：
1. 點擊「Deployments」→ 選擇最新的部署
2. 點擊「View Function Logs」
3. 搜索「[OAuth]」關鍵字查看 OAuth 相關日誌

### Q4：開發環境和生產環境可以使用不同的 Google OAuth 憑證嗎？

**A**：可以。建議為開發環境和生產環境創建不同的 OAuth 憑證：
- **開發環境**：使用 `http://localhost:8081/api/oauth/callback`
- **生產環境**：使用 `https://mvstudiopro.com/api/oauth/callback`

在 Vercel 環境變量中，可以為不同環境設置不同的值。

### Q5：如何支持多個域名（例如 mvstudiopro.com 和 www.mvstudiopro.com）？

**A**：在 Google Cloud Console 的「Authorized redirect URIs」中添加所有域名的回調 URI：
```
https://mvstudiopro.com/api/oauth/callback
https://www.mvstudiopro.com/api/oauth/callback
```

---

## 安全建議

### 1. 保護 OAuth 憑證

- ❌ 不要將 `GOOGLE_CLIENT_SECRET` 提交到 Git 倉庫
- ✅ 只在 Vercel 環境變量中設置
- ✅ 定期輪換 Client Secret

### 2. 限制授權的重定向 URI

- ❌ 不要使用通配符（例如 `https://*.mvstudiopro.com/*`）
- ✅ 只添加必要的 URI
- ✅ 確保 URI 使用 HTTPS

### 3. 監控 OAuth 日誌

- 定期檢查 Vercel 日誌中的 OAuth 錯誤
- 使用 Google Cloud Console 的「APIs & Services」→「Dashboard」監控 API 使用情況

---

## 後續優化建議

### 1. 添加其他登入方式

- Facebook OAuth
- Apple Sign In
- 微信登入

### 2. 實現 OAuth 狀態驗證

- 添加 CSRF token 驗證
- 實現 state 參數驗證

### 3. 優化用戶體驗

- 添加登入載入動畫
- 添加錯誤邊界處理
- 實現自動登入（記住我）

---

**祝您配置順利！** 🎉
