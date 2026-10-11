# 瑞芯咖啡真生成探針收尾

兩版各6張真图、2×5秒真影片、5句Qwen旁白、1個Suno job，沒有重複提交/自動重試/模型超分。兩個30秒成片已由嚴格compile及正式renderer完成；原始媒體與signed URLs僅保存在私有工作區。這不是正式登入帳戶/扣款/已部署路由驗收。

- `original-video-identities.json`：四個原task ID、原片hash與原native回執hash。
- `provider-cost.json`：四影片原生usage.cost合計USD3.454；Suno各quota6。未核實圖片/Qwen美元總額，不把估值當總實付。
- `media-probe.json`：兩成片各30秒、720×1280、30fps、900幀、單音軌；原混音相關free0.9994889144、paid0.9992112182。影片原生聲音靜音、最後只混一次原Qwen/Suno。
- `idle-gate.json`及`rig-stopped.json`：收尾前真空隊列/媒體程序/租約及停止回執。

## 未解與邊界

1. **原時長阻塞已在後續正式流程修正。** 最新用戶要求所有有效秒差應由渲染相容：採用接受有效正時長，consumer長片取選鏡範圍、短片末幀hold，原始bytes不改。四原片直接解碼各150幀，另驗1/4.6/6秒合成回歸；見 ../duration-tolerance。下載適配為本地原檔；沒有登入帳戶／GCS端到端驗收。早先成片仍是隔離probe裁準素材版本，不冒稱已重新渲染成片。
2. 本probe沒有逐詞timing資料，video段FFmpeg shortcut不覆普通scene字幕；不宣稱逐詞字幕/節拍同步的實片驗收。
3. **付費末圖烘字重疊。** 圖像模型違反無文字提示，末圖已有大品牌字；28秒成片代碼字幕與圖中文字局部重疊。未擅自多生成一張。
4. 親看了啜飲/轉春原片及成片抽幀，基本喝咖啡與冬→春語義可見；尚不能以抽幀或聲音數值測試替代完整感知驗收。
5. 音訊用正式混音helper，隔離renderer走audioUri；沒有偽造帳戶所有權DB記錄。

## 執行中斷與回收

20:48:00.439Z既有rig出現外部source=user update→replacing，原tmp消失，非本代理部署/stop。20:50:38.116Z新instance啟動後重新核真空閒，只按原四task IDs pure poll收回；沒有重POST。成片全部完成及證據保全後，21:03:49.613Z再次確認真空閒並按原授權停止rig。

所有媒體、signed URLs、完整raw response保留在私有 `pr1697-ruixin-probe`；本目錄只含可公開的精簡技術證據。
