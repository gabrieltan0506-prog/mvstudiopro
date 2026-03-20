# P0 Growth Data Regression Report

Date: 2026-03-20
Owner: Codex handoff / emergency repair
Severity: P0
Status: Open

## Summary

`Creator Growth Camp` 的 growth data 線上環境在 2026-03-20 再次出現高水位資料被低水位 `current.json` 覆蓋的事故。

這次事故不是前端快取，也不是 debug 面板單純顯示錯誤，而是 Fly volume 上的主檔：

- `/data/growth/current.json`

被實際寫成低水位版本，導致：

- 平台歷史總量大幅下降
- debug 面板回讀到低水位值
- `creator center` 一度顯示為 `0`
- 歷史回填 worker 以低水位 current 為基底重新累積，進一步放大誤判

## Observed Impact

事故發生後，線上實際讀到的 `current.json` 大小約為 `5.7MB`，而不是先前的高水位版本。

線上實際平台數量一度變成：

- `douyin`: `2762`
- `xiaohongshu`: `3131`
- `bilibili`: `1191`
- `kuaishou`: `11`
- `toutiao`: `195`

這與此前已恢復的高水位完全不一致。

此前高水位曾達到：

- `douyin`: `114k+`
- `xiaohongshu`: `78k+`
- `bilibili`: `58k+`
- `kuaishou`: `751`
- `toutiao`: `252`

## What Was Confirmed

### 1. Creator Center was not actually missing

`creator center = 0` 不是 cookie 缺失，也不是 collector 完全失效。

線上 `/data/growth/current.json` 內部仍能直接讀到：

- `douyin_creator_center_hot_video`
- `douyin_creator_center_hot_search`
- `douyin_creator_index_keyword_probe`
- `douyin_creator_index_brand_probe`
- `douyin_creator_index_hot_words_probe`
- `douyin_creator_index_topic_probe`

所以 `0` 的一部分原因，是 debug route 在輕量化後誤用了不存在的派生檔：

- `/data/growth/platforms/douyin.json`

而 Fly 線上並沒有這個派生檔。

### 2. The live file on Fly was really overwritten

事故不是 UI 誤讀。

實際檢查 Fly volume 可確認：

- `/data/growth/current.json` 存在
- 檔案大小約 `5.7MB`
- 內容已是低水位集合

也就是說，真正的 P0 是：

**低水位 `current.json` 被寫回線上主檔。**

### 3. Existing protections did not stop write regression

已加的三層保護：

- `history-ledger`
- `runtime-meta`
- `snapshot / restore scripts`

都沒有阻止這件事發生。

原因是這三層保的是：

- 歷史統計結構
- runtime 狀態
- 事後恢復能力

但沒有真正保住：

- **寫入 `current.json` 時的 monotonic guard**

也就是沒有「低水位禁止覆蓋高水位」這條硬防線。

## Root Cause

本次事故的直接根因是：

1. 線上主讀檔仍以 `/data/growth/current.json` 為核心
2. 某次寫入將低水位集合寫回了該檔案
3. 寫入前沒有做 monotonic protection
4. debug 與 backfill 之後都忠實讀到了這份低水位檔案

次級問題：

1. `creator center` debug 路徑依賴不存在的派生檔
2. 線上缺少真正可直接拉回的最新 remote data snapshot 倉
3. 本機恢復包只能補資料，不能直接整包覆蓋線上，否則會抹掉新抓到的 live data

## Why The Previous Protection Was Not Enough

### history-ledger

可以保住歷史統計來源，但不會阻止 `current.json` 被改小。

### runtime-meta

可以讓 scheduler/backfill 不必每次碰大 store，但它不保存高水位 current 集合。

### snapshot / restore scripts

可以恢復，但屬於事後補救，不是寫入時保護。

## Immediate Requirements For Closure

這次事故要一次收口，必須同時完成下面幾項：

### A. Add write-time monotonic protection

任何會改寫 `current.json` 的路徑，在正式落盤前必須比較新舊平台總量。

規則：

- 若新檔某平台總量顯著低於舊檔
- 且不是人工明示 restore / rebuild 模式
- 則拒絕覆蓋，直接保留舊檔並記錄告警

這是本次最核心缺口。

### B. Change restore from overwrite to merge

恢復時必須：

- 以線上當前 `current.json` 為 base
- 以歷史高水位恢復包為補源
- 做去重 merge
- 只補缺失，不覆蓋現在線上新抓到的資料

### C. Keep history-ledger and current in sync

恢復後要同步：

- `/data/growth/current.json`
- `/data/growth/history-ledger/*`
- `/data/growth/runtime-meta.json`

避免 current 與 history summary 再次分裂。

### D. Make debug read the real online source

`creator center` 與其他 debug summary 必須：

- 優先讀真正存在的線上來源
- 派生檔不存在時回退到 `current.json`
- 不能因為缺少派生檔就回 `0`

## Current Repair Direction

已做或正在做的修補：

1. 修復 `creator center` debug route
   - 派生檔不存在時，回退到 `/data/growth/current.json`

2. 重新確認 `historical burst`
   - 真正的 30-60 秒節奏在 `trendBackfill.ts`
   - `live scheduler` 不應被誤改成 1 分鐘

3. 加強 cross-platform seeds
   - 平台間熱點、詞彙、作者、行業訊號互餵

但上述還不等於事故結束。

真正 closure 的條件是：

1. 高水位 `current.json` 被 merge 回線上
2. 線上新增資料不丟失
3. monotonic guard 落地
4. 線上 API 驗證通過

## Verification Checklist

收口前必須線上檢查：

1. `getGrowthSystemStatus` 返回的平台總量回到高水位量級
2. `douyinCreatorCenter.currentTotal` 不為 `0`
3. `backfill.active = true`
4. 線上 `/data/growth/current.json` 檔案大小回到高水位量級
5. 連續多次刷新後，數值不再掉回低水位

## Files Involved

- [routers.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/routers.ts)
- [trendStore.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/trendStore.ts)
- [trendBackfill.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/trendBackfill.ts)
- [trendScheduler.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/trendScheduler.ts)
- [trendSeedLibrary.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/trendSeedLibrary.ts)

## Conclusion

這次事故的本質不是「資料太大」，也不是「前端沒刷新」。

本質是：

**線上主檔 `current.json` 被低水位覆蓋，而系統沒有寫入時防護。**

在 monotonic guard 與 merge restore 都落地前，這個 P0 仍然算未關閉。
