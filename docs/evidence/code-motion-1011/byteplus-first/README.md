# 映客沿用漫劇工廠 BytePlus → EvoLink

用戶指定：先BytePlus，疑似真人圖片明確拒單後轉EvoLink。新影片manifest保存byteplus-first，Mini與2.5分別使用既有BytePlus engine與request builder，復用canvasVideoTask既有回落分類與音訊參考保存；不新造另一條供應商鏈。

歷史manifest沒有route欄位時保留原EvoLink intent身份，避免原任務恢復變成新單。缺BytePlus配置時不直接偷走EvoLink。新paid INK 2.5補POST前持久marker，結果未知停止重送/自動退款，已取得原任務ID則保留原任務查詢。

驗證：targeted-tests.txt 共37項通過，涵蓋免費/付費正式提交函數、舊EvoLink恢復、新engine身份、缺配置、原worker真人圖片拒絕回落、音訊參考、paid INK unknown不重送與明確拒絕回落。供應商為mock，不表示本次新做BytePlus付費實測。既有真片均仍來自EvoLink。

限制：新paid_video局部修改只有EvoLink成本結算合同，尚未有BytePlus回執定價，現於寫入/扣費前明示阻擋；舊EvoLink修改任務可恢復。沒有猜價、擅改後台計費合同或新付費生成。未合併、未部署、未作正式線上驗收。
