# 2026-11-08 图文知识手册 · 交接报告

> 2026-11-08 收班交接。

## 一、现状一句话
- PR1751 已合并（d905a1f）。后续全部在分支 `fix/knowledge-handbook-1108b`（基于 main），**尚未开 PR**。
- 工作机（rig 7812595b294778）无任务在跑；两本书均停住，未产生新的付费请求。

## 二、已定规则（用户明文）
- 完整版：总页数 ≤72（可精简不可多）；内文页 ≥ 图片数的 1/3；原 3:1–2:1 废止。
- 精华版：图:内文 1:2–1:3，审查时精简内文，不与图重复。
- 出图：按主题决定张数，完整版 ≤16 张、精华版 ≤8 张；**每张图内文字 ≤1200 中文字**，内文不受此限。
- 版式：直式、上图下注，**图片不得单独占一页**；纯文字模块并入相关章节。
- 标题：图片主题标题、图下内文标题、各段小标题均由 LLM 写（一次便宜调用），失败退回原标题。
- 并发：一律并发；OpenRouter 实测 10 并发无限流，EvoLink/OpenAI 官方生图各 4 张同发无碍，用户 Tier 高；目标整本 ~20 分钟。
- 开发者探针不核对积分（用户本人付 API 费）；用户端报价/确认流程不变。
- 新增硬规则已写入 `.cursor/rules/collab-always.mdc` §三之一（015ce3f）：
  1. 需用户拍板：先停住子代理并确认已停，再问；无答复不发任何付费请求。
  2. 花钱前先本地验证（测试或已存回执零调用重放）。
  3. 探针失败一次带回全部原因。

## 三、分支 fix/knowledge-handbook-1108b 上的提交（要点）
- 9bff19d 探针工作流允许 `fix/knowledge-handbook-*` 触发。
- c3cc684 / 695f371 版式：章末零散内容收回前页空栏、必要时整章 snug 字号；图下首块过高时按句/表格行拆分，保证图页有注；过滤“图中已列…/此处补…”编辑备注（引导语“…如下/：”保留）；版本 v13。
- 76c7ff9 / 695f371 探针仅导出模式（点面板“下载当前版”），收到导出回应即结束。
- 主题出图：`shared/knowledgeTopicImagePlan.ts`、`server/services/knowledgeTopicTitles.ts`，预算/分页/版本准备/计数 UI/核验回执同步改。
- 13eb2af / 1de5938 标题修复：提示词改用虚构完整示例；拒收占位回声与原标题照搬；版本升级不回放 v1；生图前关卡 `auditKnowledgeTopicTitles`；探针 autoConfirm（准备→关卡→生图一次跑完，关卡不过不发图）。
- a12bdab 动态并发：`shared/knowledgeConcurrency.ts`（clamp(ceil(n/轮数),min,通道上限16)，OR 多分，首波错峰，429/keyLimit 减半），已接入读档、选节、核验、审查、排版、生图（16 张同发，官方/EvoLink 交替）、导出（逐章测量与渲染并发）。
- 3d6d429（已在 main）排版合同：强调色近义归四色、presentation.subtitle 归位——血脂排版约半数首发失败的根因。
- 015ce3f 协作硬规则。
- 测试：知识相关套件无新增失败；既有约 28 个失败未动（含 `knowledgePublicationLayout.test.ts` “自动长表分页不漏行…”）。

## 四、两本书
### 血脂（文档 0dcb5641-ad69-40fc-bde2-59ef2e20444d，ownerJob kc_f7e6e69c…）
- v2 已交付：48 页（全部图文同页），零模型重出；文件 `血脂手册-完整版-v2.pdf`。
- 待办：零模型重出 1108o（补回一句被误删引导语，非急）。
- 遗留：短注页图下留白；第 32 页药材表首栏过窄；48 张图风格雷同（生图层面）。

### 敦煌（《我心归处是敦煌》，模板 fusion_chinese_garden，文档 cbed5125…）
- 1108g2 准备完成：16 张、496 积分、sha f8eac24e…2f37、约 66 页；但标题全是占位词（已修，见上）。
- 1108h 生图在标题未修好时被启动（违规，已写规则），部署重启时自行中断；至少 10 张已生成、最多 16 张已发出，确切数待只读查询。图带程序标题，不复用。
- 部署后顺序（子代理本地已备好请求文件，未推送）：
  1. keygen（工作机重启会丢私钥）＋必要时重新加密 EPUB；
  2. 只读计时探针 `/home/claude/work/request-timing-1108h.json`：取基准耗时、1108h 实发张数、1108g2 标题原始回执；
  3. 本地零调用重放 `/home/claude/work/replay/replay-titles.mts`，报告结果；
  4. **等用户明确同意**后跑付费 1108i（新派生 id，autoConfirm，`/home/claude/work/request-1108i.json`），同时作为并发改造后的计时。

## 五、踩过的坑
- **每次推送都会触发 Vercel 部署**（用户每日 100 次额度）——包括 `probe-transfer` 分支与 `probes/knowledge-handbook/request.json` 推送。下次开工第一件事：在 `vercel.json` 用 `git.deploymentEnabled` 关掉 `probe-transfer` 与 `fix/knowledge-handbook-*`，或加 `ignoreCommand` 跳过只改 `probes/**` 的提交；并把探针传输改为少推送（合并收集、减少监看推送频率）。
- 工作机重启后 `/app/isolated/.transfer-key.pem` 丢失；旧目录残留旧密文且 sftp 不覆盖 → 换新 id。
- GitHub runner 下载 flyctl 偶发 HTTP 504，重跑即可。
- 仅导出时文档版本变化会提前返回无页数，探针曾空等（已修）。
- 单次导出 38 分钟（逐章串行渲染）——已改并发，待实测。
- 部署会打断工作机进程（Puppeteer “detached Frame”）。

## 六、下一步建议（按序）
1. 先处理 Vercel 触发问题，再做任何推送。
2. 敦煌按第四节顺序推进，付费前必须用户点头。
3. 两本书出成品后开 PR（fix/knowledge-handbook-1108b → main）。
