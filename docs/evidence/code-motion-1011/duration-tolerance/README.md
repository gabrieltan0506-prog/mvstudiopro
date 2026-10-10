# 正式渲染時長相容處理

2026-10-11 用戶最新要求：秒差不能拒絕渲染，不能人工修probe素材來配合代碼。正式adopt接受有效正時長video stream；正式consumer按選鏡秒窗取用長片，短片由FFmpeg tpad末幀hold補足。原始SHA與素材不變，解析證據記actual duration、effective start、normalization、padded seconds。空/無video/無效時長/損壞媒體仍須正確報錯，所有權、hash、nominal timeline校驗保留。

compatible-render-tests.txt 為本次最新回歸：
- 四段未裁供應商原片直接經正式prepareCodeMotionVideoFrames，各150幀，沒有預修素材。
- 合成邊界素材1秒、4.6秒、6秒送進同一5秒秒窗，皆150幀且輸入hash不變；此為工程回歸，不能冒充用戶成片探針。
- helper校驗及consumer共4個測試通過。下載適配為本地檔，ffprobe/ffmpeg真執行；不等同線上帳戶/GCS持久化驗收。

## 歷史證據（已被最新相容策略取代）

以下是先前0.1秒容差策略的通過紀錄，保留原始證據，不當成目前仍會拒短片的規格：

# 小幅時長誤差修正

用戶接受供應商5秒片段的小幅超時。採用與解碼共用 codeMotionVideoDurationMatches：最多上浮0.1秒；不足原定秒窗仍拒絕。優先採影片stream時長，避免音訊封裝padding左右影片驗證。素材SHA不改、時間軸不延長、免費次數及提交時長不改。

- unit-tests.txt：9項定向測試通過（容差與生產提交）。
- original-media-consumer.txt：原四段真實供應商MP4，不預裁、不重新生成；透過正式prepareCodeMotionVideoFrames，各輸出150幀。只將下載替換為本地檔案拷貝，FFprobe/FFmpeg實際執行；尺寸180×320縮小解碼以節省測試資源。
- 沒有遠端帳戶、採用DB/GCS寫入或部署驗收；不把共享校驗器測試當完整採用入口驗收。舊完整影片並未重製。

新增採用入口測試 adopt-tests.txt：2項通過；5.08秒video stream／5.3秒音訊容器採用成功、保存原bytes hash，二次採用不重下載；4.98秒不足原定秒窗拒收。遠端儲存使用mock，並非線上帳戶驗收。
