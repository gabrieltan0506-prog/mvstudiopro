# 0907 工作区图片备份与恢复（部分验证）

## 范围与改前证据

本批统一追加 PR #1412。只修现有工作区图片 ZIP 的导出、导入与显示恢复；不改生成引擎、价格、权限、模型参数或依赖，不发起付费任务。不扩大为视频／音轨／GLB 字节交付包。

| 层 | 真实入口／证据 | 已知断点与本批处理 |
| --- | --- | --- |
| 用户入口 | `OmniCanvas.exportBackupFile/importBackupFile` | 原导入确认前逐图写库；改为全包解析、图片解码、恢复预检、确认，再原子写库 |
| 图片生产者 | 节点图片字段、会话及偏好中的 `customAssetRefs`、两级导演板 | 旧导出只枚举节点；新收集器覆盖候选、四格图和导演板，不将视频节点当图片 |
| 转换与长期身份 | `buildLocalCloudDraftSnapshot`、`collectManhuaBackupImageSources`、`assetImageGcsUri` | 原始 URL 保留；只有读取时续签，原 URL 与已有 GCS 身份同事务登记缓存 |
| 存储 | `manhuaLocalMediaStore`，实际 IndexedDB `media` store | 旧内容哈希记录刷新后难按来源找回；按来源 SHA-256 重建 ID，另验字节 SHA-256，冲突拒绝、不覆盖旧记录 |
| 恢复消费者 | `applyCloudDraftToUi`、`cloudDraftBlocksToCanvas`、工作台图片 | 预跑实际同步恢复转换；13 处真实用户图接 `ManhuaAssetImage` 本机回退，只改 DOM，不把 blob 写回 canonical 引用 |
| 失败与权限 | 现有导入确认；服务端原有签名入口 | 未确认、缺图、坏清单、解码失败、已证实的坏深字段均不写库；无持久存储拒绝导入，不用内存成功冒充落盘 |
| 测试 | 新备份导入／导出／预检／解码／组件测试，既有媒体库、工厂及布局测试 | 实际回调与真实 ZIP 字节对账；浏览器和线上层分别验收，不能互相替代 |

## 正向与反向追链

正向：备份按钮 → 同源快照 → 图片收集器 → 本机原 URL／GCS 身份字节（缺失时已有鉴权续签入口）→ 图片解码 → ZIP 的 `snapshot.json/assets-manifest.json/assets/*` → 导入完整解析／解码／纯预检 → 用户确认 → 单个新增事务 → 原工作区恢复 → 真实图片组件显示。

反向：工作台资产／造型／预览／导演板图片 → 原 `src`（新签名可还原 GCS 身份）→ 同一来源 SHA-256 记录 → 该记录中的 Blob → 导入清单的原来源和快照已有长期身份 → 导出收集到的真实字段。组件的临时 objectURL 有卸载／换源回收，迟到结果不能写到新图。

原图、候选和节点历史不被本批覆盖。另一云恢复入口继续用原消费者；旧 JSON 无随包媒体时不触碰媒体库。既有资产上限仍为 48 张：会话或偏好任何一份超过容量时，导入前明确拒绝，不以成功提示掩盖第 49 张被裁。收集器的 101 来源测试只证明枚举无额外截断，不代表工作台容量增加。

共用恢复消费者另修旧板污染：缺少导演板字段时，三个板图／轨迹 map 整体恢复为空，同步各自独立本机存储，并清除上一工作区的已落块／已续签集合。否则旧板不仅显示，还会重新投影到画布、进入生成参考及下一份备份。此处不删除媒体库或远端资产。

## 已执行验证

- 目标命令：`pnpm exec vitest run client/src/lib/manhuaBackupImport.test.ts client/src/lib/manhuaBackupExport.test.ts client/src/lib/manhuaBackupRestorePreflight.test.ts client/src/lib/manhuaBackupImageValidation.test.ts client/src/lib/manhuaBackupImageSources.test.ts client/src/lib/manhuaLocalMediaStore.test.ts client/src/lib/manhuaAssetImage.test.ts client/src/lib/manhuaAssetImageSource.test.ts client/src/lib/canvasDramaStudio.test.ts client/src/lib/canvasDramaStudio.seriesSwitch.test.ts shared/manhuaSeedanceLayout.test.ts`
- 13:31 原始结果：`Test Files 11 passed (11); Tests 193 passed (193)`，退出 0。随后 ZIP 无类型 SVG 解码兼容补丁另行复验，以下追加最终结果。
- `pnpm check`：退出 0。
- `git diff --check`：退出 0；新文件已用项目 Prettier 格式化，未格式化整个巨大页面。
- 真实 ZIP 解包：节点外主图、候选、集级与段级导演板恰 4 张，PNG 字节逐张一致；清空内存映射模拟刷新仍零网络取字节。新签名再次导出按已导入 GCS 身份取字节，ZIP 保留新快照原地址。
- 故障对账：取消零存储／零 UI；缺图、空图、坏深字段、容量超限在写库前拒绝；同源不同字节保留旧图且不留半包新来源；HTTP200 错误页或解码失败仅警告不报全图成功。

### 最终补充回归

- 13:42 重跑以上 11 个文件，另加 `client/src/lib/manhuaBackupRestore.browser.test.ts` 和 `client/src/lib/manhuaBackupBoardRestore.test.ts`：`Test Files 13 passed (13); Tests 200 passed (200)`，退出 0，7.91 秒。
- 无界面浏览器完全离线，使用独立 browserContext，不连接用户窗口。真实 IndexedDB 写入 1 张图片的原来源／GCS 两条记录，刷新后旧记录字节不变，新签名加载失败后真实图片组件显示 `naturalWidth=1/naturalHeight=1`；原引用仍为 HTTPS，卸载后临时 URL 全部回收。
- 真实浏览器解码 PNG 和清单指定 MIME 的无类型 SVG 成功；损坏 PNG 字节和 HTML 拒绝，3 个临时 URL 全部回收。解包 Blob 的空 MIME 只在解码副本中补清单类型，不改变字节，不能掩盖明确 HTML/JSON 类型。
- 在真实 `IDBObjectStore.add` 第二次调用后执行实际 `transaction.abort()`，两个新来源读回均为 `null`；原记录全部字节／元数据及刷新后的结果不变。此测试没有模拟整个数据库，但仍不等同于真实设备的配额耗尽验收。
- 工作台旧板真实恢复片段 3 项通过：缺字段／null 清理 UI 与三个独立存储；新板保留 GCS／URL，刷新与下一份备份均无旧板地址。
- 全仓 `pnpm exec vitest run`：`2 failed | 531 passed | 2 skipped (535)` 文件；`2 failed | 5130 passed | 4 skipped (5136)` 测试，196.20 秒，退出 1。失败为 `manhuaNativeDeepReadBatchCli.test.ts:127` 的 7201 上限断言（预期退出 1、实际退出 0）和 `manhuaNativeDeepReadProbeCli.test.ts:83` 同一旧上限断言；这两个测试、对应两份 CLI 和 `manhuaNativeDeepReadExecution.ts` 与 `origin/main` 无 diff。本轮不修改读片冻结参数或这些旧断言。
- 全仓之后的 SVG 兼容、真实浏览器和旧板修正由上述最终 200 项覆盖，未再次重复整仓。Node `v24.13.1`、pnpm `10.4.1` 与 Dockerfile 基础版本一致；没有新增依赖。
- 最后新增测试曾暴露 3 处 TypeScript 错误（缺完整快照类型两处、浏览器结果 unknown 一处）；改为真实快照工厂和对象匹配断言后，最终 `pnpm check && pnpm build --incremental false && pnpm exec vite build` 整链退出 0。Vite 输出 `3556 modules transformed`、`built in 16.14s`；保留既有混合导入与大 chunk 警告，未为消警告扩大改动。这里 `pnpm build` 为项目的 tsc 门禁，运行时仍按 Dockerfile 使用 tsx，不冒充另有服务端 emit 构建。

## 九层状态审计

| 检查层 | 状态 | 证据／限制 |
| --- | --- | --- |
| 需求与边界 | 已验证 | 图片备份原入口；视频、音轨和 3D 字节明确排除；无新计费调用 |
| 入口与交互 | 部分完成 | 真实回调测试；用户原浏览器窗口尚未实点 |
| 数据生产 | 已验证 | 真实快照收集与 ZIP 4 张逐字节对账，不是空 map |
| 契约与转换 | 部分完成 | 原来源／长期身份／旧字段保留；已证实坏类型与容量前置拒绝，不承诺完整业务 schema |
| 服务与副作用 | 部分完成 | 现有鉴权续签调用契约未改；未做线上签名、计费或退款实跑 |
| 存储与恢复 | 部分完成 | 来源哈希、字节冲突、真实 IndexedDB 中止／刷新已验证；用户设备配额极限及完整工作台刷新仍未验收 |
| 消费与展示 | 部分完成 | 13 个生产图片消费点已接线；真实浏览器解码和组件 1×1 PNG 已验证，尚未线上实际资产审看 |
| 静态与回归 | 部分完成 | 目标 200、最终类型、无增量 build、Vite 通过；全仓 5130 通过／2 个旧 CLI 断言失败 |
| 真实链路 | 部分完成 | 未做线上实跑；离线真实浏览器测试与线上验收分别报告 |

## 限制与后续门禁

1. 本 ZIP 只随包图片和工作区引用；视频、音频和 GLB 文件需另备份，不能称完整媒体交付包。
2. 丢失图片的 ZIP 仍保留快照地址，但明确为不完整图片备份。原地址过期且无可用长期身份／本机字节时不能凭空恢复。
3. 纯预检防已证实的同步恢复错误，不是全业务 schema 重建。存储与 UI 不是跨浏览器事务，不把单元测试等同于用户设备配额／崩溃恢复验收。
4. 线上状态必须另查。每次合并前重新核对在途学习与冲突部署；存在学习或无法确认时不合并部署，其他施工继续。后续待部署改动保持同一 PR #1412。
