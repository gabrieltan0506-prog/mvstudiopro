# 2026-10-04 创作顾问常驻与每作品计费

## 本批行为

- 顾问默认展开，桌面保留独立侧栏；用户收起后记住该账户在本机的选择，停止自动建议，重新打开可恢复。回答支持 Markdown。
- 漫剧当前集有内容且编辑/生成稳定 8 秒后检查当前步骤；关注人物动机、关系、时间逻辑、灯光、氛围、表演、运镜，以及白模、3DGS、角色建模的具体用途，优先复用资产。不自动生成、渲染或采用素材，不把文字检查当作实际审片。
- 同一账户、作品与内容复用自动检查请求编号；余额、聊天回包、队列文案变化不会触发新检查。新步骤或内容变化才产生新请求。
- 每账户每部作品 5 次免费，手动提问、自动建议、配乐/字幕顾问共用；之后每次 12 积分，先确认确切金额才提交。沿用既有管理员/监督者免扣积分规则，未变更模型调用成本。
- 服务端验证登录账户自己的云作品；额度用稳定作品 ID，不用标题或确认时间。旧单作品工作区每账户一个 legacy 桶，不因改名或重新确认刷新额度。旧每日额度无法可靠按作品归属，新的每作品账本从此策略启用时开始计数，不追溯扣减。
- 已付费请求先回放原回执，不因云保存服务暂时不可读而挡住取回；新请求仍必须校验归属。失败退回本次免费占位，付费失败沿用原幂等退款。原 8 积分确认不能当作 12 积分同意。
- 未确认草稿也保留问答恢复编号，确认作品后迁移一次；原历史及来源保留，已完成 pending 不在重开后复活。

## 文件与审查

分支：`feat/manhua-advisor-project-quota-1004`，基于 main `2cff4ac4bf0f467be80d45598fefa6c0bfe7c42b`。
核心：shared/manhuaAdvisorPolicy.ts、server/services/manhuaAdvisorProjectQuota.ts、server/routers.ts、server/services/platformSkillQa.ts、client/src/components/canvas/ManhuaCreativeAdvisorPanel.tsx、client/src/hooks/useManhuaAdvisorPreference.ts、OmniCanvas 与上下文生产者，以及 BgmCreativeAdvisor/PostProdSubtitleCard。
服务端口径为 userId + projectId，额度 UPSERT 及有条件释放均在数据库执行；只查询本人 GCS 对象元数据验证存在性。原云稿恢复/CAS 保存逻辑未更改。额度账本为 succeeded 行，当前 staleJobsReaper 不清理该状态。
旧 wire 字段 remainingFreeToday/dailyLimit 为兼容保留名称，在漫剧咨询返回值代表作品额度；非漫剧平台问答和白模渲染价格/每日额度不改。

## 验证及复用证据

证据目录：`/Users/tangenjie/Documents/Codex/2026-10-03/task-2/backend-work/`。

| 范围 | 结果与日志 |
| --- | --- |
| 计费路由、策略、作品归属 | 首次 23 项通过，advisor-project-1004-tests.log |
| 调整回执重放先于云校验后 | 仅 2 项受影响路由通过，16 项跳过，advisor-project-1004-replay-fix.log |
| 实际顾问组件离线浏览器 | 2 项通过：常驻/关闭记忆/自动去重/Markdown/主区不遮挡/收费先确认/额度失败恢复；advisor-project-1004-browser-final.log |
| 新增草稿迁移检查 | 仅新增 1 项通过，另 2 项跳过；advisor-project-1004-draft-migration.log |
| 目标文件类型 | 修正 Uint8Array 兼容后 0 错误；最后变更 3 文件 0 错误，advisor-project-1004-release-types.log。不是全仓库 tsc |

未重跑旧测试组。三个旧浏览器夹具仅补 Streamdown CSS loader 和作品额度文案断言，不声称本轮执行。新夹具最初遇到字体 loader、构建目录、JSX 配置及 Markdown DOM 选择器错误，已修正并仅复验失败/新增路径，原日志保留。第一次 Vite 构建 36.94 秒通过；后续接入配乐/字幕作品身份及草稿恢复后，执行一次最终构建，结果见下方收口记录。

## 尚未验证与发布边界

- 浏览器使用真实 React 组件和本地构建 CSS，但额度与模型接口为离线桩；无生产模型调用、无真实扣分或退款、未访问用户媒体内容。
- 未在真实 PostgreSQL 并发连接中验证争抢最后免费名额；路由测试模拟该竞争，SQL 审查采用既有单行 UPSERT 方式。GCS 归属错误路径为桩验证。
- 未做当前功能的手机操作验收、生产部署或线上验收。原生产任务及用户作品没有改写。
- 三张漫剧画布、资产/3D、后期示意图已展示，仍等待用户选定；本批仅实现已单独授权的顾问，不代表三张布局均落地。
- PR #1661 已合并，当前顾问改动需要后续 PR；当前未创建、未合并或部署。仓库 AGENTS.md 要求“原PR已合并/关闭时先如实说明，不自行创建替代PR”，待用户确认后集中发布。
- 原有无关 client/src/lib/manhuaAssetEditSubmit.test.ts 两行保持原样，不纳入本批。

## 最终本机收口

2026-10-04 21:07 CST：最后 3 文件定向类型 0 错误；最终 Vite 构建 44.64 秒通过（advisor-project-1004-release-build.log，保留大 chunk 警告）。源文件未再改动，未为时间戳重跑任何通过项。3 项浏览器用例按 2+1 增量通过，23 项单测及 2 项路由定向补验复用对应证据。git diff --check 通过。源文件与关键日志 SHA-256 清单见 docs/1004-advisor-project-quota-evidence.json。

### 稿件再次确认的增量补验
21:08 CST 收口审查发现仅按目的稿版本记录迁移不足：再次确认新稿可能重新继承同一条已完成草稿请求。补上来源记录去重，保留全文；只复验草稿迁移用例，新增跨 confirmed version 断言通过（advisor-project-1004-next-version-migration.log，1 passed、2 skipped）。因此前一构建的源码前提已改变，定向检查本次2文件并重建最终产物；旧计费与其他浏览器通过项不重跑。

增量收口：最后两文件类型0错误（advisor-project-1004-next-version-types.log）；最终源码 Vite 构建43.16秒通过（advisor-project-1004-next-version-build.log），原大chunk警告保留。此后仅更新文档和证据指纹，不再运行测试或构建。
