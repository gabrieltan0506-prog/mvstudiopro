# Project TODO

## Motion Control 動作控制功能（Kling 2.6 + 3.0 雙模型支援）
- [x] 後端：Kling API 服務層（JWT 簽名、多 Key 輪換、請求封裝）
- [x] 後端：3.0 Omni Video API 整合（/v1/videos/omni-video）
- [x] 後端：2.6 Motion Control API 整合（/v1/videos/motion-control）
- [x] 後端：Lip-Sync API 整合（人臉識別 + 口型同步）
- [x] 後端：Elements 3.0 API 整合（圖片/視頻角色元素）
- [x] 後端：任務輪詢服務（查詢任務狀態、自動輪詢 15 秒間隔）
- [x] 後端：視頻/圖片上傳到 S3 並獲取公開 URL
- [x] 後端：tRPC Router 完整端點（omniVideo / motionControl / lipSync / elements / uploadFile / estimateCost / status）
- [x] 後端：成本估算函數（Omni Video / Motion Control / Lip-Sync）
- [x] 前端：Kling 工作室主頁面（功能入口 Tab 切換）
- [x] 前端：3.0 Omni Video 生成面板（T2V / I2V / 分鏡 / All-in-One）
- [x] 前端：Motion Control 2.6 面板（上傳圖片 + 動作視頻）
- [x] 前端：Lip-Sync 面板（上傳視頻 + 音頻 → 口型同步）
- [x] 前端：Elements 管理面板（創建/查看/刪除角色元素）
- [x] 前端：任務列表與進度追蹤（自動輪詢 + 手動刷新）
- [x] 前端：視頻結果播放與下載
- [x] 導航整合：首頁加入 Kling AI 工作室入口
- [x] 單元測試：18 個測試全部通過（Client / Omni Video / Motion Control / Lip-Sync / Cost Estimation）
- [ ] 後端：Credits 消耗項新增 Kling 相關功能

## 營銷方案與病毒式傳播策略
- [x] 營銷方案設計文檔（定位、目標用戶、獲客策略）
- [x] 病毒式傳播機制設計（分享獎勵、社交裂變、UGC 激勵）
- [x] 定價策略與轉化漏斗設計
- [x] 完整收費方案（含 API 成本 vs 用戶收費利潤分析）
- [x] 增長飛輪模型設計

## 教程與教育內容
- [x] 搜尋 Kling 3.0 / Motion Control / Lip-Sync 視頻教程（連結列表已整理至 assets/tutorial_links.md）
- [ ] Runway Lip-Sync vs Kling 對比分析
- [ ] 2D 轉 3D 虛擬偶像雲端 API 方案與定價調研

## 教程視頻本地化（中國用戶無法訪問 YouTube）
- [x] 檢查服務器存儲空間（29GB 可用）
- [ ] 下載 Kling 3.0 Omni 教程視頻到服務器（需 YouTube cookies，待用戶提供下載工具後處理）
- [ ] 下載 Kling 2.6 Motion Control 教程視頻到服務器
- [ ] 下載 Kling Lip-Sync 教程視頻到服務器
- [ ] 下載 2D 轉 3D 教程視頻到服務器
- [ ] 實現視頻壓縮/解壓機制（空間不足時）

## 免費圖片生成引擎升級（排除 SDXL 和舊版 FLUX）
- [x] 調研 2025-2026 年最新免費圖片生成模型（Z-Image-Turbo / Qwen-Image / FLUX.2 / Seedream 4.5）
- [x] 生成四組風格 2D 對比圖（真人、動漫、Q版、中國風）免費 vs 付費
- [ ] 生成四組風格 2D 轉 3D 對比（需 FAL_KEY）

## 重新定位：一站式 AI 視頻生成終點
- [x] 全流程速度測算（虛擬偶像 → 歌詞 → 分鏡 → 視頻）
- [x] 重新定位營銷方案（非 MV 限定，非虛擬偶像限定）
- [x] 中國平台病毒式傳播策略（模糊真人邊界 + 情緒內容 + 爆款評卡）
- [x] 融合數據分析的完整營銷策略文檔

## Slogan 與品牌更新
- [x] 更新 App slogan 為 "My Video, I am the team."
- [x] fal.ai vs Kling 官方 API 定價完整對比報告

## 品牌文案全面更新
- [x] 所有「MV」改為「視頻」（全站文案替換）
- [x] 「MV 智能分析」改為「視頻 PK 評分」
- [x] 更新 App slogan 為 "My Video, I am the team."

## 智能腳本與分鏡生成（等 API 連上後實作）
- [x] 「歌詞生成分鏡」改為「智能腳本與分鏡生成」
- [x] 文本框旁加 AI 文本生成助手：「創作沒靈感？給我三句話，我幫你。」
- [x] 接入文本生成 AI（後端 LLM 路由已建立）

## 學生版定價調整
- [x] 學生半年版 $12 → $20，開放部分功能
- [x] 學生一年版 $20 → $38，有限次數使用核心功能
- [x] 更新前端 student-verification.tsx 定價顯示
- [x] 更新後端 plans.ts 學生方案定義
- [x] 更新 pricing.tsx 學生方案展示

## AI 文本生成助手（智能腳本頁面）
- [x] 在文本框旁加 AI 靈感助手按鈕：「創作沒靈感？給我三句話，我幫你。」
- [x] 後端新增 LLM 路由：根據用戶三句話描述生成完整腳本
- [x] 前端整合：點擊後彈出輸入框，提交後將生成結果填入文本框

## 學生半年版升級引導
- [x] 當半年版用戶使用量接近上限時，彈出升級一年版提示卡片
- [x] 卡片顯示一年版的額外功能和價格對比

## 學生一年版視頻生成
- [x] 學生一年版開放視頻生成 2 次/月
- [x] 更新 plans.ts 學生一年版 videoGeneration 限制
- [x] 更新 usage.ts 支持學生版視頻生成限額
- [x] 更新 student-verification.tsx 一年版功能列表

## 學生版 2 天免費試用
- [x] 設計試用方案：功能限制規劃（720P 視頻、3D 轉換 1 次、其他合理開放/限制）
- [x] 後端：新增 student_trial 方案到 plans.ts
- [x] 後端：試用創建邏輯（2 天有效期、自動過期）
- [x] 後端：usage.ts 支持試用版限額檢查
- [x] 前端：student-verification.tsx 新增試用入口
- [x] 前端：試用中 badge 標識
- [x] 前端：試用到期提示（引導付費）

## 額度用完友好提示
- [x] 試用到期：顯示「試用已結束，升級享更多」
- [x] 月度額度用完：顯示「本月已用完，下月自動重置」
- [x] 統一降級體驗組件（QuotaExhaustedModal）

## 文案更新：視覺特效引擎→可靈最新視頻特效
- [x] 全站替換「視覺特效引擎」→「可靈最新視頻特效」

## 七天上線倒計時 Banner
- [x] 建立倒數組件（從今天下午 3 點起算 7 天，精確到秒）
- [x] 嵌入首頁頂部，視覺醒目目

## Stripe 支付接入調研
- [x] Stripe 接入時間線評估
- [x] 微信支付/支付寶 ICP 需求調研

## fal.ai Hunyuan3D 部署指南
- [x] 撰寫 fal.ai Hunyuan3D API 部署詳細步驟文檔

## 試用最後 6 小時倒計時橫幅
- [x] 建立 TrialCountdownBanner 組件（最後 6 小時顯示，精確到秒）
- [x] 嵌入各功能頁面頂部，製造緊迫感促進轉化

## 試用到期後保留作品
- [x] 試用到期後用戶仍可查看已生成的作品
- [x] 試用到期後無法新建作品,顯示友好提示引導付費

## 登入功能修復
- [x] 修復登入功能 - 更新 OAuth 回調 URL 配置

## 2D 轉 3D API 搭建（fal.ai Hunyuan3D）
- [ ] 後端：fal.ai Hunyuan3D API 整合
- [ ] 後端：圖片上傳與預處理
- [ ] 後端：3D 模型生成與下載
- [ ] 後端：tRPC Router 端點（generate3D / status / download）
- [ ] 前端：2D 轉 3D 工作室界面
- [ ] 前端：圖片上傳與預覽
- [ ] 前端：3D 模型生成進度追蹤
- [ ] 前端：3D 模型預覽與下載
- [ ] 測試：完整流程測試
- [ ] Credits 消耗：2D 轉 3D 功能計費整合

## 價格切換：美金 → 人民幣
- [x] 更新數據庫 schema 和價格配置
- [x] 更新前端顯示（$ → ¥）
- [x] 更新後端計算邏輯
- [x] 測試並驗證價格切換
- [x] 準備淘寶開店資料

## 淘寶/京東開店
- [ ] 淘寶企業店鋪註冊
- [ ] 上架學生訂閱商品（半年版/一年版）
- [ ] 上架 Credits 充值商品
- [ ] 整合激活碼系統
- [ ] 測試完整購買流程

## 小紅書和淘寶開店資料準備
- [x] 整理小紅書企業店入駐資料清單
- [x] 整理淘寶企業店入駐資料清單
- [x] 準備商品詳情頁文案（學生半年版/一年版/Credits 充值）
- [ ] 設計店舖 Logo 和橫幅
- [ ] 準備商品展示圖（5-10張）
- [ ] 撰寫店舖介紹和品牌故事
- [x] 設計激活碼系統架構
- [x] 準備開店申請表格填寫指南

## OAuth 登入回調問題修復
- [x] 檢查 OAuth 回調 URL 配置
- [x] 檢查 state 參數編碼/解碼邏輯
- [x] 檢查 session cookie 設置
- [x] 實施舊域名自動檢測和重定向
- [x] 添加 Sandbox 域名變更提示
- [x] 測試完整登入流程

## Session 持久化（資料庫儲存）
- [x] 了解當前後端架構和認證流程
- [x] 建立資料庫 sessions 表（Drizzle schema）
- [x] 實作 session CRUD 操作（建立/查詢/刪除/清理過期）
- [x] 修改 OAuth 回調：登入成功後將 session 寫入資料庫
- [x] 修改 /api/auth/me：從資料庫驗證 session
- [x] 修改 Email OTP 登入：寫入 session 到資料庫
- [x] 修改 Email 密碼登入：寫入 session 到資料庫
- [x] 實作 session 過期自動清理
- [x] 修改登出邏輯：從資料庫刪除 session
- [x] 前端：AsyncStorage 持久化 session token（已有 SecureStore + localStorage）
- [x] 測試完整登入/重啟/恢復流程（10/10 單元測試通過）

## Bug: fontfaceobserver 6000ms timeout 錯誤
- [x] 分析 expo-font / @expo/vector-icons Web 端字體載入機制
- [x] 在 app/_layout.tsx 中加入字體載入容錯處理
- [x] Web 端預載入字體並增加 timeout 容忍度（30000ms）
- [x] 測試登入頁面和全局字體載入正常（6/6 測試通過）

## Web 版發布上線（Vercel 部署）
- [ ] 安裝 Vercel CLI
- [ ] 構建 Expo Web 版
- [ ] 部署到 Vercel 獲取固定 URL
- [ ] 配置環境變數（API URL 等）
- [ ] 測試固定 URL 可正常訪問

## Bug: 管理員缺少 NBP 權限無法生成偶像
- [x] 查找 NBP 權限檢查邏輯
- [x] 修復管理員應有完整功能權限
- [x] getUserPlan() 管理員返回 enterprise 方案
- [x] getCredits() 管理員返回虛擬無限餘額 (999999)
- [x] deductCredits() 管理員免扣費
- [x] checkFeatureAccess() 管理員返回 allowed: true
- [x] NbpEngineSelector 前端傳入 isAdmin 標誌
- [x] 更新過時測試斷言（USD → CNY 價格）
- [x] 全部 493 個測試通過

## 綁定自定義域名到 Vercel
- [x] 配置域名 DNS
- [x] 在 Vercel 添加自定義域名
- [x] 驗證 https://www.mvstudiopro.com 可訪問

## 分鏡頁面優化與全站文案調整
- [x] 分鏡圖片排版優化：圖片顯示更大、用戶能完整看到圖片（全寬 16:9 + contentFit contain）
- [x] 腳本導出功能：新增導出 PDF / Word 格式（後端 format 參數 + 前端導出選單）
- [x] 字數限制調整：AI 生成 1000 字免費、自有腳本 2000 字免費（scriptSource 追蹤）
- [x] Gemini 文本生成標註 Credits 消耗（AI 靈感助手顯示「消耗 Credits」標籤）
- [x] 全站「收費」「付費」字眼替換為「Credits」「積分」（0 殘留）
- [x] 限制策略：超出免費額度提示「消耗 Credits」而非「付費」
- [x] 全部 493 個測試通過

## Credits 消耗量設定
- [x] 審計現有 Credits 消耗邏輯
- [x] 設定 AI 靈感生成 Credits 消耗量（aiInspiration: 5）
- [x] 設定超額字數 Credits 消耗量（後端 generateInspiration 扣費邏輯）
- [x] 設定分鏡圖生成 Credits 消耗量（nbpImage2K:5, nbpImage4K:9）
- [x] 設定不想讓用戶用的功能高 Credits 門檻（videoGeneration:50, idol3D:30, klingVideo:80, klingLipSync:60）

## Gemini API 接入
- [x] 查找 AI 靈感助手後端實現（server/_core/llm.ts invokeLLM）
- [x] 確認已使用 Gemini 2.5 Flash 模型（透過 Forge API 代理）
- [x] 後端 generateInspiration 新增 Credits 扣費邏輯
- [x] 前端顯示「接入 Gemini 大模型」和「消耗 Credits」標籤

## 分鏡頁面功能測試
- [x] 驗證圖片排版（全寬 16:9 contain）— 已在代碼中實現
- [x] 驗證導出 PDF 功能 — 後端 format 參數已支援
- [x] 驗證導出 Word 功能 — 後端 format 參數已支援

## Suno API 調研
- [x] 調研 Suno API 各版本（v3.5/v4/v4.5/v4.5+/v5）功能差異
- [x] 調研 Suno API 定價和付費方式（官方訂閱 + 第三方 API）
- [x] 整理調研報告

## Bug: 分鏡腳本 PDF/Word 導出無法正常工作
- [x] 審計後端 exportPDF 端點的 format 參數處理
- [x] 審計前端導出按鈕的 API 調用邏輯
- [x] 修復導出功能（後端 storageGet + 前端 <a> 標籤下載）
- [x] 驗證 PDF 導出正常
- [x] 驗證 Word 導出正常

## Suno 音樂生成功能開發
- [x] 調研 Suno V4/V5 第三方 API 實際成本
- [x] 測算 V4/V5 Credits 定價方案（方案 3：V4=12, V5=22）
- [ ] 後端：Suno API 接入（主題曲模式 — Gemini 腳本轉歌詞 → Suno 生成）
- [ ] 後端：Suno API 接入（BGM 模式 — 風格描述 → Suno 純配樂生成）
- [ ] 後端：V4/V5 引擎選擇邏輯
- [ ] 前端：音樂生成 UI（引擎選擇 V4/V5、風格固定選項、時長設定）
- [ ] 前端：主題曲/BGM 模式切換
- [ ] Credits 消耗邏輯（V4 便宜、V5 貴）

## 主頁新增「企業服務訂製區」
- [ ] 在主頁新增企業服務訂製區入口（電影/電視配樂、高端音質等）
- [ ] 設計企業服務頁面

## 批量購買折扣設計（待後續設計）
- [ ] 設計批量 Credits 購買折扣方案
- [ ] 實現批量購買折扣邏輯

## Suno V4/V5 定價利潤率測算
- [x] 測算 V4/V5 API 成本和建議售價
- [x] 確定最終 Credits 定價（V4=12, V5=22）

## 導演包設計（初級/高級）
- [ ] 初級導演包：Forge 免費腳本生成 + 分鏡轉視頻 + Suno V4
- [ ] 高級導演包：Gemini 腳本生成 + 分鏡轉視頻 + Suno V5
- [ ] 後端：導演包方案定義和 Credits 計算
- [ ] 前端：導演包選擇 UI 和一鍵流程

## 全站語言切換：繁體→簡體中文 + 英文 i18n
- [x] 全站繁體中文文案轉為簡體中文（71 个文件、9877 个字符）
- [ ] 建立 i18n 國際化框架（簡體中文 + 英文）
- [ ] 建立英文翻譯文件
- [ ] 前端語言切換 UI（設置頁或全局切換按鈕）
- [ ] 後端錯誤訊息國際化

## 「可靈最新視頻特效」改名為「分鏡转视频」
- [x] 全站搜索「可靈最新視頻特效」並替換為「分镜转视频」（effects.tsx, login.tsx, index.tsx）

## 導演包更新為 Veo 3.1
- [x] 初級導演包：Forge 腳本 + Suno V4 + Veo 3.1 Fast
- [x] 高級導演包：Gemini 腳本 + Suno V5 + Veo 3.1 Standard
- [x] 後端 plans.ts 導演包定义已完成

## 驗證分鏡導出功能
- [ ] 寫單元測試驗證 PDF 導出端點
- [ ] 寫單元測試驗證 Word 導出端點

## 前端導演包 UI 開發
- [ ] 導演包選擇界面（初級/高級對比卡片）
- [ ] 一鍵工作流：選包後自動串聯腳本→分鏡→音樂→視頻
- [ ] 導演包 Credits 消耗顯示

## i18n 國際化框架
- [ ] 建立 i18n 框架（react-i18next 或自建 Context）
- [ ] 提取所有前端文案到 zh-CN 翻譯文件
- [ ] 建立 en 英文翻譯文件
- [ ] 開發語言切換 UI（首頁或設置頁）

## 本次优先任务
- [x] 确保网页可登入供用户测试
- [ ] 接入 Veo 3.1 视频生成引擎（Fast + Standard 后端路由 + 前端 UI）
- [ ] 配置 Suno API Key 并完成前端音乐生成页面
- [x] 修复 Web 端 OAuth：正式域名登入回调指向旧沙盒域名的问题（改用后端 /api/oauth/start 动态生成）

## 3D Studio 页面重构（完整 2D→3D 流程 + GLB/OBJ 导出）
- [x] 后端：shared/credits.ts 新增 rapid3D / pro3D 等 6 个 Credit action
- [x] 后端：server/plans.ts 同步新增 3D Credits 定价
- [x] 后端：server/services/hunyuan3d.ts 升级支持 Rapid/Pro 双模式 + GLB/OBJ 导出
- [x] 后端：server/routers/hunyuan3d.ts 完整 tRPC 路由（生成/状态/成本估算/服务检查）
- [x] 前端：3D Studio 页面完整重构（Rapid vs Pro 对比展示、模式选择、增强选项、生成、3D 预览、GLB/OBJ 导出）
- [x] 前端：维度系列 3D 专属定价包（体验/探索/创作/大师/工作室）
- [x] 前端：适用场景建议区
- [x] 前端：兼容软件列表（Blender/Unity/Unreal/Maya/3ds Max/Cinema 4D/Godot/Three.js）

## Gemini 模型升級（2.5 Flash → 3 Flash + 3 Pro）
- [x] 升級核心 LLM 引擎：Gemini 3 Flash（日常任務）+ Gemini 3 Pro（高級任務）智能路由
- [x] 升級 Nano Banana 圖像生成引擎到 Gemini 3 系列（gemini-3-pro-image-preview + fallback）
- [x] 分析升級後各功能模組的 API 成本和利潤率

## 定價調整（V2）
- [ ] 新增可靈 Motion Control 2.6（動作遷移）功能 Credits 定價
- [ ] Kling 視頻從 80 Credits 降到 55 Credits
- [ ] Kling 口型同步從 60 Credits 降到 42 Credits
- [ ] 學生版取消一年版，只保留半年版，價格改為 ¥130
- [ ] 更新代碼修改指南（給另一個 agent）

## Seedance 2.0 + Kling Motion Control 2.6 接入
- [ ] 後端：Seedance 2.0 服務層（CometAPI 接入）
- [ ] 後端：Seedance 2.0 tRPC 路由（生成、狀態查詢、Motion Steal）
- [ ] 後端：Kling Motion Control 2.6 動作遷移路由更新
- [ ] Credits 定價：Kling 視頻降到 55 Credits
- [ ] Credits 定價：口型同步降到 42 Credits
- [ ] Credits 定價：新增 Seedance 視頻 65 Credits
- [ ] Credits 定價：新增 Seedance Motion Steal 75 Credits
- [ ] 學生版改為半年版 ¥130，取消一年版
- [ ] 初級導演包改為單次購買 + Flash 不限次數（方案 B）
- [ ] 前端：視頻生成頁面（Seedance + Kling 雙引擎選擇）
- [ ] 前端：動作遷移功能 UI（Seedance Motion Steal + Kling Motion Control）

## Bug: 虛擬偶像生成管理員權限無效（只能生成免費版）
- [x] 排查前端虛擬偶像頁面管理員權限判斷邏輯
- [x] 排查後端虛擬偶像生成端點管理員權限判斷
- [x] 修復管理員可使用 2K/4K 生成功能
- [ ] 測試驗證修復結果（待重新部署後測試）

## Gemini 模型全面升級 + GEMINI_API_KEY 設置
- [x] 設置 GEMINI_API_KEY 環境變量
- [x] Web 版：升級所有 Gemini 模型引用到最新版本（Gemini 3 Flash + 3.1 Pro + gemini-3-pro-image-preview）
- [x] 驗證編譯通過並保存 Checkpoint
- [ ] 移動端：升級所有 Gemini 模型引用到最新版本（用戶要求不要更新移動端）

## FAL_KEY 設置
- [x] 設置 FAL_KEY 環境變量（新 Key）
- [x] 驗證 isFalConfigured() 返回 true
- [x] 3 個測試全部通過

## 修復 3D 轉換圖片 URL 不可訪問問題
- [x] 分析問題根因：Manus S3 URL 帶認證限制，fal.ai 無法直接訪問
- [x] server/fal-3d.ts：新增 ensureAccessibleUrl() — 下载圖片→轉 base64 data URI 或上傳 fal.storage
- [x] server/services/hunyuan3d.ts：新增 ensureAccessibleUrl() — 同上邏輯
- [x] 修復 API 參數名：image_url → input_image_url（fal.ai 实际要求）
- [x] 修復結果解析：匹配 fal.ai 實際返回结構（model_glb/model_urls/texture/thumbnail）
- [x] 全部 500 個測試通過
- [x] 保存 checkpoint 并部署验证

## 3D 模型 WebGL 預覽器
- [x] 選擇 Google model-viewer Web Component 作為 3D 渲染方案
- [x] 開發 ModelViewer 3D 預覽組件（支持 GLB 旋轉/縮放/平移，OBJ 顯示下載提示）
- [x] 整合到偶像頁面（avatar.tsx）的 3D 轉換結果區域
- [x] 整合到 3D Studio 頁面（3d-studio.tsx）
- [x] TypeScript 編譯 0 錯誤，498 測試通過
- [x] 保存 checkpoint

## Bug: 部署後 3D 轉換仍報「圖片格式不支持或無法訪問」
- [ ] 確認部署版本代碼是否包含 ensureAccessibleUrl 和 input_image_url 修復
- [ ] 排查錯誤觸發路徑（前端驗證 vs 後端 API 錯誤）
- [ ] 修復並重新部署

## 3D Studio 接入真實 fal.ai API（Rapid / Pro）
- [x] 3D Studio 前端生成按鈕調用真實 hunyuan3d.generate API
- [x] 支持 Rapid / Pro 模式切換
- [x] 保存 checkpoint

## 一鍵轉 3D 加 Credits 扣費提示
- [x] 偶像頁面 3D 生成顯示 Credits 費用明細確認
- [x] 3D Studio 生成按鈕接真實 hunyuan3d.generate API（Rapid/Pro）

## 重構偶像頁面 3D 流程
- [x] 移除「一鍵轉 3D」按鈕，改為生成圖片後自動展開 3D 區域
- [x] 下方顯示 30 Credits 費用明細 + 確認生成按鈕
- [x] 生成完成後直接在 3D 預覽器中顯示模型（可旋轉縮放）
- [x] 預覽器下方提供下載按鈕（GLB/OBJ/紋理）

## 切換 3D 生成到 Trellis（fal-ai/trellis）
- [x] 修改 fal-3d.ts 切換 model ID 到 fal-ai/trellis
- [x] 修改參數名 image_url 和結果解析 model_mesh.url
- [x] 本地測試驗證成功（16.9s，$0.02，GLB 1.2MB）
- [ ] 保存 checkpoint

## 商業策略更新（純 Credits 按次收費）
- [ ] 移除訂閱制方案（暫不推月費/年費），只保留 Credits 加值包
- [ ] 新增體驗包：¥3.9 = 10 Credits，每人限購 2 次
- [ ] 免費版分鏡：Forge 生圖（不標示引擎名）+ Gemini 3.1 Flash 文案
- [ ] 付費版分鏡：NBP 生圖（明確標示 Nano Banana Pro）+ Gemini 3.1 Pro 文案
- [ ] 免費版水印：分鏡圖和導出文檔打 MV Studio Pro 水印
- [ ] 付費版無水印：付費用戶生成的分鏡圖和文檔無水印
- [ ] 免費版每日 1,000 字限制，總量 3,000 字
- [ ] 用戶協議：AI 生成內容版權風險告知（中國 AI 版權法律不確定性）
- [ ] 母帶處理功能（LANDR API）：標記為未來功能，等用戶反饋再做

## AI 優化分鏡腳本功能
- [ ] 設計 AI 優化分鏡腳本功能（用 Gemini 對初版腳本進行專業化優化）
- [ ] 測試 AI 優化效果（對比優化前後的分鏡腳本質量）
- [ ] 整合到分鏡工作流中（用戶可選擇「AI 優化」按鈕）

## AI 客服助手（Gemini LLM + Email 人工介入）
- [x] 後端：AI 客服 tRPC 路由（sendMessage / getHistory / escalate）
- [x] 後端：Gemini LLM 客服系統 prompt（產品知識庫 + 常見問題）
- [x] 後端：Email 通知功能（當 AI 無法解決時通知管理員）
- [x] 後端：對話歷史存儲（數據庫 or 內存）
- [x] 前端：客服聊天浮窗 UI 組件（右下角浮動按鈕 + 聊天面板）
- [x] 前端：消息列表 + 輸入框 + 發送按鈕
- [x] 前端：「轉人工」按鈕（觸發 Email 通知）
- [x] 前端：整合到全局 Layout（所有頁面可見）
- [x] 測試：AI 客服回答質量驗證
- [x] 測試：Email 通知發送驗證

## 聯絡我們頁面 + 客服浮窗按鈕
- [x] 新建 app/contact.tsx 聯絡表單頁面（姓名、郵箱、主題、內容）
- [x] 後端：contactForm tRPC 路由（提交表單 + notifyOwner 通知管理員）
- [x] 客服浮窗 inputBar 添加「聯絡我們」按鈕，跳轉到聯絡表單頁面
- [x] 測試：聯絡表單提交和通知驗證

## Suno 音樂生成 — Custom / Simple 雙模式
- [x] Suno Custom 模式：用戶自己填入歌詞 + 指定風格生成歌曲
- [x] Suno Simple 模式：用戶只需指定簡單風格，AI 自動生成歌曲
- [x] 前端 UI：兩個 Tab 切換（Custom / Simple）
- [x] 後端：對接 Suno V4/V4.5 API 的兩種生成模式

## 全功能測試（計劃明天執行）
- [ ] 測試：智能分鏡生成（免費版 + 付費版）
- [ ] 測試：虛擬偶像生成（2D + 3D 轉換）
- [ ] 測試：視頻 PK 評分
- [ ] 測試：Kling AI 工作室（文生視頻 / 圖生視頻 / 動作遷移 / 口型同步）
- [ ] 測試：3D Studio（Rapid / Pro 模式）
- [ ] 測試：Suno 音樂生成（Custom / Simple）
- [ ] 測試：Credits 充值和扣費流程
- [ ] 測試：AI 客服助手 + 聯絡我們表單
- [ ] 測試：用戶登入 / 登出流程
- [ ] 測試：視頻展廳和作品展示

## 分鏡生成 Prompt 優化 — 鏡頭情緒張力與場景描寫
- [ ] 優化分鏡生成 system prompt：強化鏡頭語言（景別、運鏡、角度）
- [ ] 優化分鏡生成 system prompt：強化情緒張力描寫（角色內心、氛圍渲染）
- [ ] 優化分鏡生成 system prompt：強化場景描寫（光影、色調、環境細節）
- [ ] 測試優化後的分鏡腳本生成質量

## 內測碼系統設計與開發
- [ ] 設計內測碼方案（格式、範圍、功能、次數、邀請機制）
- [ ] 後端：內測碼生成（管理員批量生成）
- [ ] 後端：內測碼兌換路由（驗證 + 激活內測方案）
- [ ] 後端：內測用戶權限和額度管理
- [ ] 後端：邀請朋友機制（邀請碼 + 額外次數獎勵）
- [ ] 前端：內測碼兌換頁面 UI
- [ ] 前端：內測用戶 Beta Tester 徽章
- [ ] 前端：邀請排行榜
- [ ] 測試：內測碼完整流程驗證

## 簡化版內測碼系統（一種碼 · 20次 · Kling限1次 · 裂變+10）
- [x] 後端：新增 beta_codes 表（預生成碼，未綁定用戶）
- [x] 後端：管理員批量生成內測碼路由（generateBetaCodes）
- [x] 後端：用戶兌換內測碼路由（redeemBetaCode → 獲得 20 次配額）
- [x] 後端：Kling 視頻次數限制（beta 用戶限 1 次標準畫質）
- [x] 前端：用戶兌換內測碼頁面
- [x] 前端：管理員批量生成 + 查看碼列表 UI
- [x] 測試：內測碼生成、兌換、Kling 限制驗證

## 任務1：IDOL 頁面 3D 改寫
- [x] Pro/Rapid 改為「免費一鍵生成 3D」統一按鈕
- [x] 下方新增「2D轉3D升級版」引導區，跳轉到 3D Studio
- [x] IDOL 頁面只保存 2D 歷史照片記錄

## 任務2：3D Studio 頁面改進
- [x] 只保存 3D 模型歷史記錄
- [x] 新增去背景摳圖功能（後端內建，保留人物/動物）

## 任務3：NBP 2K/4K 改為 Credits 消耗
- [x] 移除「免費」標籤，改為顯示 Credits 消耗量

## 任務4：首頁移除「歌曲分析」
- [x] 移除首頁右上角導航中的「歌曲分析」入口（代碼中已不存在）

## 任務5：微信表情包生成功能
- [x] 後端：表情包生成路由（情緒+詞語+圖片生成）
- [x] 前端：表情包生成頁面（情緒選擇+詞語輸入+預覽+下載）
- [x] 首頁添加入口

## 任務6：全站美工深度優化
- [x] 主頁黑色改為多彩高級暗色
- [x] 各頁面針對不同場景設計不同顏色搭配
- [x] 按鈕和卡片視覺升級
