# 已採用視頻的普通代碼修改：P1 最小安全封鎖

問題：普通 code-only 修改原先會刪掉選中鏡頭的原視頻，保留 `speech.role=dialogue`。新 compile guard 要求對白必須有完成視頻，但 code-only revision grant 禁止視頻工具，所以可能先消耗修改次數，留下不可輸出的子稿。只保留影片也不夠：現在 renderer 只把 timing-word/timing-beat 特殊層疊在影片上，一般 heading/body/顏色改動不會真的呈現。

修法：不假造 overlay 能力，不刪原片。

- `shared/codeMotionRevision.ts::codeMotionRevisionUnsupportedVideoEdits` 以 scene 時窗與既有 clips 實際重疊找出普通修改；`reviseCodeMotionProject` 在改稿前拒絕。
- `server/services/codeMotionRevisionProposal.ts` 對該類提案移除 changes、加入具體 limitations，明確原片未改；其它可修改鏡頭仍保留，原片動作修改仍走已授權 motionPrompt 路徑。
- `server/services/codeMotionRevision.ts` 在 ledger／quota／子稿持久化之前再次驗證；繞過提案直接提交也不消耗次數。
- 伺服端補 limitations 可多於模型的原 6 條；模型輸出 parse 仍維持原 6 條，不用 retry 來重複呼叫模型。

定向命令：

```sh
pnpm exec vitest run shared/codeMotionRevision.test.ts server/services/codeMotionRevisionProposal.test.ts server/services/codeMotionRevision.test.ts -t 'code-only edits over|proposed code overlay|local revision updates|rejects code edits'
```

結果：**4 passed / 11 skipped**，原始輸出 `code-overlay-gate.log`。測試核對被拒後 GCS fixture 全 key/bytes/generation 不變、剩餘免費次數仍 2、沒有子稿、原 clip/對白角色不變；另驗未重疊代碼鏡頭正常修改且保留所有原片。未重跑全量，主代理統一 TS。沒有 paid call、正式上線驗收或新 PR。
