# 第二集采用后的确认范围修复

开发 Agent 模型：GPT6 Astra（用户指定标注）。基线0da1d48b54f213b8d665c1e7bf199cbb082c992f。

正式页面已完成第二集正文采用与刷新恢复；当前64节点、第一集正文与23个视频节点保持。继续前发现再次确认只读localStorage旧备份，无法取得IndexedDB中的changedEpisodeIndexes=[2]，可能按无范围重铺。因此未点击确认，先修读取链。

## 实现与追链

- 完整不可变快照和旧备份沿同一账户/项目命名空间读取，再用原完整新稿及项目版本匹配；读取失败上抛，不当作无改写记录。
- 单集确认、只恢复确认均等待结果；顾问确认、下一步、旧编剧按钮同步等待布尔结果。读取期间作品、快照、画布或任务变化会中止；共用确认锁阻止重复确认和批量入口交叠。
- 已有作品的单集确认没有匹配记录时，也只处理当前集；明确全剧批量确认的原范围与确认对话保留。
- 正向为采用→IDB完整快照→刷新→读取真实范围→只重铺对应集；反向由保留的第一集活动成片追到原clip ID、URL及快照。不增加模型调用、计费或数据库结构。

## 验证

- `pnpm exec vitest run client/src/lib/manhuaAdvisorQuota.browser.test.ts client/src/lib/manhuaSceneProductionBackups.browser.test.ts client/src/lib/manhuaWriterTimedGate.test.ts client/src/lib/manhuaAdvisorAdoption.test.ts client/src/lib/omniCanvasDirectionDeps.test.ts`：44项通过，2个旧夹具缺少projectBible上下文失败。补齐空项目上下文后，仅对失败的2项定向复验通过。
- `pnpm exec vitest run client/src/lib/manhuaWriterReconfirmation.test.ts`：6项通过；总计52项不同用例通过。涵盖真实回调、异步竞态、重复提交、批量入口锁、第一集活动成果保留和恢复确认不可绕过。
- 原生Chromium复现旧读取缺失导致第一集归档；新读取返回[2]，第一集保持活动；错误账户/版本/作品不匹配，IDB读取失败明确拒绝。完整快照不可变、跨刷新、账号/项目隔离测试通过。
- `pnpm exec tsc --noEmit --incremental`：exit0。`pnpm exec vite build`：成功23.11秒，保留既有大chunk警告。`git diff --check`通过。

## 未验边界

Fly隔离回归已于2026-10-08T04:04:18+08:00通过：原worker为performance 4vCPU/8GB，门禁jobs/workflows/steps/media均空，原生Linux Chromium复现旧读取归档第一集、新读取[2]保留第一集及读取失败拒绝；回执见fly-safe-receipt.json。浏览器finally关闭，模型调用0。正式页面再次确认、分镜表与预演绑定尚未验；隔离夹具不代表真实素材或整集预演交付。当前规则要求用户本人合并，本PR保留未合并，不触发正式部署。
