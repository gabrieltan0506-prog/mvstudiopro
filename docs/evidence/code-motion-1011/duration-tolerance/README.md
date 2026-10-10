# 小幅時長誤差修正

用戶接受供應商5秒片段的小幅超時。採用與解碼共用 codeMotionVideoDurationMatches：最多上浮0.1秒；不足原定秒窗仍拒絕。優先採影片stream時長，避免音訊封裝padding左右影片驗證。素材SHA不改、時間軸不延長、免費次數及提交時長不改。

- unit-tests.txt：9項定向測試通過（容差與生產提交）。
- original-media-consumer.txt：原四段真實供應商MP4，不預裁、不重新生成；透過正式prepareCodeMotionVideoFrames，各輸出150幀。只將下載替換為本地檔案拷貝，FFprobe/FFmpeg實際執行；尺寸180×320縮小解碼以節省測試資源。
- 沒有遠端帳戶、採用DB/GCS寫入或部署驗收；不把共享校驗器測試當完整採用入口驗收。舊完整影片並未重製。

新增採用入口測試 adopt-tests.txt：2項通過；5.08秒video stream／5.3秒音訊容器採用成功、保存原bytes hash，二次採用不重下載；4.98秒不足原定秒窗拒收。遠端儲存使用mock，並非線上帳戶驗收。
