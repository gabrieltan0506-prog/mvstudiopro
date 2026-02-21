# MV Studio Pro - Vercel 部署指南

本指南將教您如何將 MV Studio Pro 部署到 Vercel 並綁定自定義域名 mvstudiopro.com。

---

## 前置準備

- ✅ GitHub 倉庫：https://github.com/gabrieltan0506-prog/mv-studio-pro
- ✅ GoDaddy 域名：mvstudiopro.com
- ⏳ Vercel 帳號（如果沒有，請先註冊：https://vercel.com/signup）

---

## 步驟 1：在 Vercel 上導入項目

### 1.1 登入 Vercel

1. 訪問 https://vercel.com
2. 點擊「Sign Up」或「Log In」
3. 選擇「Continue with GitHub」使用 GitHub 帳號登入

### 1.2 導入 GitHub 倉庫

1. 登入後，點擊「Add New...」→「Project」
2. 在「Import Git Repository」頁面，找到 `mv-studio-pro` 倉庫
3. 點擊「Import」

---

## 步驟 2：配置環境變量

在「Configure Project」頁面，點擊「Environment Variables」，添加以下環境變量：

### 2.1 必需的環境變量

| 變量名 | 值 | 說明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生產環境標識 |
| `DATABASE_URL` | `您的資料庫連接字符串` | PostgreSQL 資料庫連接 |
| `JWT_SECRET` | `您的 JWT 密鑰` | 用於生成 JWT token |
| `S3_BUCKET` | `您的 S3 bucket 名稱` | S3 儲存桶名稱 |
| `S3_REGION` | `您的 S3 區域` | S3 區域（例如 us-east-1） |
| `S3_ACCESS_KEY_ID` | `您的 S3 Access Key` | S3 訪問密鑰 |
| `S3_SECRET_ACCESS_KEY` | `您的 S3 Secret Key` | S3 密鑰 |
| `OPENAI_API_KEY` | `您的 OpenAI API Key` | OpenAI API 密鑰 |

### 2.2 可選的環境變量

| 變量名 | 值 | 說明 |
|--------|-----|------|
| `EXPO_PORT` | `8081` | Expo Metro Bundler 端口 |
| `PORT` | `3000` | 後端 API 端口 |

---

## 步驟 3：部署項目

### 3.1 開始部署

1. 確認所有環境變量已添加
2. 點擊「Deploy」按鈕
3. 等待部署完成（約 3-5 分鐘）

### 3.2 查看部署結果

部署完成後，Vercel 會提供一個臨時域名，例如：
- `https://mv-studio-pro.vercel.app`
- `https://mv-studio-pro-gabrieltan0506-prog.vercel.app`

訪問這個域名，確認應用正常運行。

---

## 步驟 4：在 GoDaddy 配置 DNS

### 4.1 登入 GoDaddy

1. 訪問 https://www.godaddy.com
2. 登入您的帳號
3. 進入「My Products」→「Domains」
4. 點擊 mvstudiopro.com 旁邊的「DNS」按鈕

### 4.2 添加 DNS 記錄

在「DNS Management」頁面，添加以下記錄：

#### 記錄 1：A 記錄（根域名）

| 類型 | 名稱 | 值 | TTL |
|------|------|-----|-----|
| A | @ | `76.76.21.21` | 600 秒 |

#### 記錄 2：CNAME 記錄（www 子域名）

| 類型 | 名稱 | 值 | TTL |
|------|------|-----|-----|
| CNAME | www | `cname.vercel-dns.com` | 600 秒 |

**注意**：
- `76.76.21.21` 是 Vercel 的 A 記錄 IP 地址
- 如果 GoDaddy 不允許根域名使用 CNAME，請使用 A 記錄

### 4.3 保存 DNS 配置

1. 點擊「Save」保存 DNS 配置
2. DNS 生效需要 10 分鐘到 48 小時（通常在 1 小時內生效）

---

## 步驟 5：在 Vercel 綁定自定義域名

### 5.1 添加域名

1. 在 Vercel 項目頁面，點擊「Settings」→「Domains」
2. 在「Add Domain」輸入框中輸入 `mvstudiopro.com`
3. 點擊「Add」

### 5.2 驗證域名

Vercel 會自動檢測 DNS 配置：

- ✅ 如果 DNS 配置正確，Vercel 會顯示「Valid Configuration」
- ❌ 如果 DNS 配置錯誤，Vercel 會顯示錯誤信息和建議

### 5.3 添加 www 子域名（可選）

1. 重複步驟 5.1，添加 `www.mvstudiopro.com`
2. Vercel 會自動將 www 重定向到根域名

### 5.4 啟用 HTTPS

Vercel 會自動為您的域名申請 SSL 證書（Let's Encrypt），通常在 5-10 分鐘內完成。

---

## 步驟 6：驗證部署

### 6.1 訪問域名

1. 訪問 https://mvstudiopro.com
2. 確認應用正常運行
3. 確認 HTTPS 證書有效（瀏覽器地址欄顯示鎖圖標）

### 6.2 測試功能

1. 測試用戶登入功能
2. 測試分鏡生成功能
3. 測試付款提交功能
4. 測試 PDF 導出功能

---

## 常見問題

### Q1：DNS 配置後多久生效？

**A**：DNS 生效時間取決於 TTL 設置和 DNS 服務器緩存，通常在 10 分鐘到 48 小時之間。您可以使用以下工具檢查 DNS 是否生效：

- https://dnschecker.org
- https://www.whatsmydns.net

### Q2：Vercel 顯示「Invalid Configuration」怎麼辦？

**A**：請檢查以下幾點：

1. DNS 記錄是否正確添加
2. DNS 是否已生效（使用 dnschecker.org 檢查）
3. 是否刪除了舊的 DNS 記錄（例如舊的 A 記錄或 CNAME 記錄）

### Q3：如何查看 Vercel 部署日誌？

**A**：在 Vercel 項目頁面，點擊「Deployments」→ 選擇最新的部署 → 點擊「View Function Logs」或「View Build Logs」。

### Q4：如何更新環境變量？

**A**：在 Vercel 項目頁面，點擊「Settings」→「Environment Variables」→ 編輯或添加環境變量 → 點擊「Save」→ 重新部署項目。

### Q5：如何重新部署項目？

**A**：有兩種方式：

1. **自動部署**：推送新代碼到 GitHub，Vercel 會自動觸發部署
2. **手動部署**：在 Vercel 項目頁面，點擊「Deployments」→ 最新的部署 → 點擊「Redeploy」

### Q6：Vercel 免費版有什麼限制？

**A**：Vercel 免費版（Hobby Plan）的限制：

- ✅ 無限項目
- ✅ 無限部署
- ✅ 100 GB 流量/月
- ✅ 無限帶寬
- ❌ 無法添加團隊成員
- ❌ 無法使用自定義構建時間（最多 45 秒）

如果您的應用流量較大，建議升級到 Pro Plan（$20/月）。

---

## 後續優化建議

### 1. 配置 CDN 加速

Vercel 已經內置了全球 CDN，但您可以進一步優化：

- 使用 Cloudflare CDN（免費）
- 優化圖片（使用 WebP 格式）
- 啟用 Gzip 壓縮

### 2. 監控和分析

- 使用 Vercel Analytics（免費）監控網站性能
- 使用 Google Analytics 追蹤用戶行為
- 使用 Sentry 監控錯誤和異常

### 3. 備份和恢復

- 定期備份資料庫
- 使用 Vercel 的「Rollback」功能回滾到之前的部署
- 保存環境變量備份

---

## 聯繫支持

如果您在部署過程中遇到問題，可以：

1. 查看 Vercel 官方文檔：https://vercel.com/docs
2. 訪問 Vercel 社區：https://github.com/vercel/vercel/discussions
3. 聯繫 Vercel 支持：https://vercel.com/support

---

**祝您部署順利！** 🎉
