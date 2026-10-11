# 原片修改：已核對的接口合同（2026-10-11）

本輪用戶指定免費修改用標準Seedance2.0，付費修改用2.5。這是已有片段的編輯，首次沒有原片時仍沿原BytePlus優先生成鏈；不把首次拒單當成有片可編輯。

- [EvoLink Seedance2.0 reference-to-video](https://evolink.ai/docs/en/api-manual/video-series/seedance2.0/seedance-2.0-reference-to-video)：官方明確包含video editing，原片使用video_urls；模型ID仍是seedance-2.0-reference-to-video，沒有假造seedance-2.0-video-edit。output duration為4–15整數秒，免費路徑480p。2.0標準版與Mini分開。
- [EvoLink Seedance2.5 video-edit](https://evolink.ai/docs/en/api-manual/video-series/seedance2.5/seedance-2.5-video-edit)：原片是第一個video_urls；duration=-1、aspect_ratio=adaptive。輸出跟隨原片，可能縮短最多0.4秒。已確認的聲軌另外沿既有時間軸混音，不把生成原音與原旁白重疊播放。
- [EvoLink 2.5定價](https://evolink.ai/seedance-2-5)：720p video edit 每計費秒USD0.180，輸入按max(輸入總秒數,輸出秒數)計，另加輸出秒數；auto/edit輸出向上取0.1秒。既有content_filter=false有1.1倍費率。上游預留不是最終實付，估算不得寫成原生實報金額。平台沿既有換算合同及用戶2倍費用要求。

接口限制與工程策略：先驗父作品權威原片、SHA、尺寸及實際時長，再占修改次數/扣費。不能因尺寸不足暗中調WaveSpeed付費超分。用戶後續明確要求有效秒差不要拒渲染：短片可補最後一幀、長片取用選鏡窗，須保存raw與處理身份及策略，不能冒稱生成新動作；此相容處理亦適用首次生成。

本文件僅記錄已核對的合同，不證明新流程已完成或已付費實測。OpenRouter video-edit尚未接入，本輪選用用戶允許的EvoLink通道；既有OpenRouter builder缺video input不可用改名冒充支持。
