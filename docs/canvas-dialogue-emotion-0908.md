# 逐句情绪选择：改前证据与验收

| 检查项 | 证据及边界 |
| --- | --- |
| 用户结果 | 每句对白可点选中文情绪，不必手写英文；声线独立选择。 |
| 允许范围 | 现有19种合法控制的中文选择器及回归；不新增上游参数、模型、定价、自动生成或发布。 |
| 真实入口/生产者 | 工厂与自由画布共用CanvasAudioStudio；目前只有语气标签输入框。新按钮经patchCue写cue.emotion。 |
| 转换/存储 | 原emotion字符串上限80、输入指纹、audioStudio云清洗与恢复保持；旧组合和未知旧值不静默清除。 |
| 最终消费者 | compileCanvasDialogueInput将标签放入input，再由canvasAudio.generateDialogue→canvasDialogueOperation→既有TTS路由消费；最终视频只用已确认的同输入音频候选。 |
| 权限/失败恢复 | 选择不提交请求；修改清除确认并保留候选；同号恢复读取原输入，不用新情绪重发原单。管理员及普通用户的既有权限与结算不改。 |
| 测试与已知断点 | 验证中文点选→真实组件请求、组合反选/清空、旧草稿恢复、旧候选失效保留、容量拒绝；新选择情绪的实际声音效果未线上验收。 |

当前状态：本地部分验证，尚未提交、推送或发布。上一批PR #1419已双端发布，本批不沿用其部署回执。

## 改后双向追链

正向：工厂/自由画布的共用音轨组件 → 中文复选框 → toggleCanvasDialogueControl → patchCue → cue.emotion → compileCanvasDialogueInput → generateDialogue.input → 服务端相同控制校验及原TTS路由。实际离线浏览器回调得到 `[serious][empathetic]别怕，站我身后。`，不是只显示中文标签。

反向：视频audioUrls → 已确认take.inputKey → 当前cue的音色/情绪/原句 → 云清洗恢复的同一emotion → 复选框checked。改为 `[angry]` 后原take仍存在，但输入指纹不一致，不能被当作新情绪出片。取消确认、修改中/在途返回、原编号恢复继续沿用旧合同；本次不改服务端、计费及草稿schema。

## 分层状态

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 需求与边界 | 已验证 | 19个既有控制分情绪/表达方式两组中文勾选；声线独立，不造新参数。 |
| 入口与交互 | 已验证（本地） | 11项音轨真实浏览器测试及1项工厂切段测试通过；取消勾选、清空、组合、旧确认取消。 |
| 数据生产 | 已验证（本地） | 真实组件generateDialogue回调input逐字包含两标签和原台词；勾选自身零调用。 |
| 契约与转换 | 已验证（本地） | 19项一一映射测试；未知旧值保留并拒绝生成；超过80字符保留原值，不静默截断。 |
| 服务与副作用 | 部分完成 | 原服务/路由/幂等恢复回归通过，无服务修改；本次未实跑模型及结算。 |
| 存储与恢复 | 已验证（本地） | JSON再挂载选中态恢复；真实云清洗函数保留同一情绪组合；线上刷新未验。 |
| 消费与展示 | 部分完成 | checkbox回显、请求原文、旧take指纹拒收已验；情绪实际声音效果未验。 |
| 静态与回归 | 已验证（目标范围） | 33文件369测试通过，类型/服务端/Vite/diff检查退出0。 |
| 真实线上链路 | 已实现但未验证 | 本批未发布；不把旧版手填标签的效果冒充新菜单验收。 |

## 命令与原始结果

- `pnpm exec vitest run`：前次报告列出的30个目标文件，加 `client/src/lib/canvasAudioStudioRecovery.test.ts`、`server/services/canvasDialogueCharge.test.ts`、`shared/manhuaSeedanceLayout.test.ts`；输出 `Test Files 33 passed (33)`、`Tests 369 passed (369)`、`Duration 26.76s`。
- 独立4文件目标回归：`27 passed (27)`，包括本批两项真实浏览器、两项控制及一项云往返回归。
- `pnpm check`、`pnpm build`、`pnpm exec vite build`、`git diff --check`：最终全部退出0。Vite `3563 modules transformed`、`built in 24.02s`，原有大chunk/混合导入警告保留。
- 首轮类型检查发现两处新测试回调缺类型，已补CanvasAudioCue并复跑通过。一次从旧报告提取测试名的命令误读文档后文而报 `Unknown option --noEmit`，没有执行测试；已限定首个30文件列表并重跑上述369项。
- 未执行本批全仓、Docker、线上菜单、全情绪听音验收；无新增依赖，没有改模型、结算、权限或发布配置。

## 实际修改文件

- `client/src/components/canvas/CanvasAudioStudio.tsx`
- `client/src/lib/canvasAudioStudio.browser.test.ts`
- `client/src/lib/manhuaAudioStudio.browser.test.ts`
- `shared/canvasDialogueControls.ts`
- `shared/canvasDialogueControls.test.ts`
- `shared/canvasAudioStudio.test.ts`
- `docs/canvas-dialogue-emotion-0908.md`
- `.cursor/knowledge/PROGRESS.md`
- `.cursor/knowledge/manhua-factory-brief.md`
- `.cursor/knowledge/kb/line-canvas.md`

## 限制与下一步

情绪组合仍受原80字符字段上限约束；控制是模型请求意图，不保证听感。旧高级语气标签原样保留、默认折叠。上线需要新的发布授权与载体，不能继续向已合并PR #1419冒充追加发布。

## 双入口审查与推送授权

用户随后要求两边都要有、做好并审查、然后推送。当前授权包含提交和推送，不包含本增量合并或部署。沿用当前功能分支推送，不新建PR、不触发main部署。

独立子代理只读审查未发现P0–P2；独立5文件46项通过、diff检查退出0。另补完整ManhuaScriptWorkbench和FreeformCanvas的浏览器路径：工厂两段分别保存[serious]/[angry]，切回复选框正确；自由画布原节点入口保存[serious][very slowly]、恢复后仍选中、运行中禁用；两路径生成调用均为空。该文件最终2项通过、6.86秒，随后pnpm check退出0。最初自由画布测试环境缺QueryClientProvider及登录态，导致报错/既有权限降档；仅补测试运行上下文，生产代码、鉴权和模型入口限制均未改。

自由画布沿用现有2.5多模态节点入口，本轮未扩展到其他成片档位。现行新菜单始终在同一共享组件中，工厂和自由画布不维护两份选择器。本批共10个修改文件（见上表）。远端main另有平台线更新，音轨核心文件与本分支HEAD一致；本次推送不合入无关平台改动。

提交前最终统一回归（包含新增双入口用例）：同一33文件命令输出 `Test Files 33 passed (33)`、`Tests 370 passed (370)`、`Duration 24.15s`，退出0；再次 `git diff --check` 退出0。此结果更新前文369项基线，不代表已做线上实跑。
