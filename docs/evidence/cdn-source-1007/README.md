# CDN 來源解析修復（2026-10-07）

Base: ca7a3c9957229f022146a217cc53dde970259c2b

## 問題與原因

使用者來源 `https://0996zp.com/vod/play/119048/1/961125`。Fly 10:15:39Z、10:17:09Z 只有 external playback refresh failed: episode=1，舊 catch 未留底層原因，不能追溯證明兩次回覆完全相同。

18:34 北京時間在 Fly 以原生讀取函式核對同一來源：每一跳 Cookie/Authorization 均存在（只觀測布林值）；307 → 同站 /GE/CC/VALIDATOR → 307 → 原 API 200。三檔 1080/720/480 均指向 ppvod021.zyxsuntech.com；原白名單僅 kqgfbs.com，原解析器拒收所有檔位。回覆 945 bytes，SHA256 54ddaba84b4223ac7fa6d3cfcef71614a3b5adc10bb8dcde70df49ced4d45d44。

## 修改

- 加入使用者指定 9zhoukj.com、fntcome.com、sizhengxt.com、pumeiduolehuo.com；0996zp.com 原已存在。來源精確匹配，不擴大子網域。
- 新 CDN 僅精確放行 ppvod021.zyxsuntech.com。720 優先、匿名與已鑑權差異、DNS/redirect 安全檢查不變。
- 外部來源刷新失敗保留既有脫敏診斷，取消立即傳播；使用者錯誤不含簽名或憑證。
- 原候選最多三發不变，新增來源排在旧鏡像之前。

## 驗證

共 8 個受影響離線用例分次通過：5 個新來源邊界、1 個三發鏡像切換、1 個脫敏診斷、1 個新 CDN 排序/匿名/仿冒域拒絕。沒有重跑通過且前提不變的整組測試。

在 Fly 復用同一原始回覆，隔離加载新純解析模組，保持線上 /app 未改。沿原 probeNativeDeepReadDurationSec 及公開 DNS 檢查，選出的 720 檔讀得 8166.074954 秒；0 模型呼叫、沒有提交學習、沒有重打取得成功的 API。原始回覆、請求布林元資料、解析 JSON、ffprobe JSON 保留 /data/diagnostics/cdn-119048-20261007；不將簽名 URL 或憑證寫入 Git。

正式站仍需此 PR 部署後從使用者入口驗收；以上是 Fly 原生函式輔助探測，不是正式工作流驗收。不代用戶合併或部署。

獨立急修樹 `pnpm exec tsc --noEmit --incremental --tsBuildInfoFile /tmp/cdn-1007.tsbuildinfo` exit 0，日志 `/tmp/cdn-1007-tsc.log`。5 個源碼/測試文件 SHA 與前述通過用例所在樹逐一一致；未重跑用例。

## 使用者追加：新 CDN 自動適配

可信來源站雙鑑權成功回覆 code=200 時，對其中新媒體網址逐次驗證 HTTPS、公網 DNS 與轉址；預檢連線固定至本次驗證 IP，最多4次轉址，沒有 Cookie/Authorization/sign。核驗得到的精確主機僅傳給本次回覆解析，不寫全域白名單、不變更來源鑑權域。保留來源原始 payload 不修改；解析使用轉址後的候選。HEAD 拒絕不等同影片不可播，最終仍沿原影片候選探測。

新增16個定向離線測試分次通過：12個發現/匿名/不擴域/公網DNS固定/私網轉址/取消；2個原生來源函式雙鑑權接線；2個 HEAD403/405不誤殺候選。原8個已通過且前提不變的用例未重跑。

Fly 新預檢 helper 對原回覆的720影片地址實際成功（2026-10-07T11:05:54.740Z），原/最終主機均ppvod021.zyxsuntech.com、0模型呼叫、沒有送来源鑑權。證據 `/data/diagnostics/cdn-119048-20261007/automatic-cdn-preflight.json`，開發bundle SHA 7a9e123d5284628c52345d81581b1edaaea79d1e5c7f8e37389adb6a2482ab62。後續僅放寬 HEAD 非2xx的候選保留與修正Set→Array.from，不影響本次2xx預檢證據，未重打已過探針。

限制：自動適配的是可信來源 API 回傳的影片CDN；可攜帶來源Cookie/Token的站點網域仍须用户明确确认，防止任意站點取得帳號憑證。公網預檢不代表影片內容質量或整片學習通過。

自動適配版增量 TypeScript 檢查通過（exit 0，/tmp/cdn-discovery-1007-tsc-r2.log）；首輪Set迭代相容錯誤已修，未改專案編譯目標。
