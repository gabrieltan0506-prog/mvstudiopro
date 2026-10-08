# 已审文字分镜免费导入：验证记录

状态：开发与隔离探针已验证；正式线上导入、采用、保存恢复尚未验收。

基线：PR #1682 合并后的 a9b538cbdb8afa6f7431c7e99f2da8c6dd80685f。开发 Agent 模型：GPT6 Astra（按用户指定标注）。

## 实际改动

- `canvasDramaStudio.ts`：生成与导入共用同一分镜物化函数；免费导入必须有完整有效秒位，不补秒、不联网。
- `ManhuaStoryboardImportEditor.tsx`：正文下新增分镜原文编辑器，草稿按项目/集隔离，刷新恢复；正文变更须先核对，失败保留原文。本集容量沿已有设置，用户明确选择，不静默改默认值。
- `OmniCanvas.tsx`：校验后只保存并显示原候选面板；已存在或结果未知的请求不覆盖。采用继续经原确认、源版本校验、改前备份和画布保存。
- `AGENTS.md`：落实用户要求的所有媒体提交前展示、确认及产物展示规则。

## 双向链路与边界

入口为编剧/大纲同一正文编辑器，导入原文 → readManhuaTimedStoryboard → 本集reverse与beats同源 → expandManhuaShotKeyartsAfterReverse → VoiceStoryboardCandidate。采用后才写入画布，分镜/片段/预演消费者读取同一源。反向从resolveShotsForEpisodeKeyartsResult追至beats/reverse与候选text。其他集保持原完整对象；旧媒体链接保留，但旧图源版本不冒充新稿。

候选和未采用草稿只在本机保存，不能称跨设备同步。采用后的画布使用既有本地/云草稿保存链；其线上行为本批未实跑。容量设置复用既有writerSession持久化；生成仍须另行展示素材、片段数与费用并确认。没有改API、数据库、计费、退款、模型路由或依赖。

## 命令及结果

- `pnpm exec vitest run client/src/lib/creativeVoiceStoryboard.import.test.ts client/src/lib/creativeVoiceStoryboard.pipeline.test.ts`：既有记录14项通过（8导入、6原生产）。实际测试文件名以原日志为准。
- `pnpm exec vitest run client/src/lib/creativeVoiceStoryboard.import-host.test.ts client/src/lib/manhuaStoryboardImportEditor.browser.test.ts`：最终10项通过（7宿主、3开发浏览器）；不同用例合计24。浏览器为真实组件的本地夹具，所有网络请求拦截，不是正式Chrome验收。
- `pnpm exec tsc --noEmit --incremental false`：最终退出0。
- `pnpm exec vite build`：最终退出0，31.94秒；存在既有大bundle警告。
- `git diff --check`：通过。
- Fly Linux执行本次实际代码bundle与AST抽取宿主：7项通过、退出0，上传前后SHA256一致；见fly-safe-receipt.json。夹具仅虚构素材，不读生产项目，不调用模型或媒体生成。

首轮问题保留：fixture错误使用非法容量值auto，真实getter回落默认固定容量后正确阻止34镜/170秒。第二轮改真实getter，显式选择auto_by_source验证全部镜头，并新增默认超限阻断用例。UI同时提供现有容量选择，未取消容量门禁。初始类型错误与测试定位/fixture错误已修正并定向复验；复验不计新增覆盖。

## 未验与下一断点

新34镜总体方向用户已审；实际音轨与秒位未锁定，测试170秒仅虚构数据，不能当本剧锁秒。25句音轨、完整动作/3DGS预演及正式视频尚未产出。本批无付费、媒体渲染或模型请求。待用户本人合并并正式部署后，在原Chrome真实项目验收导入、候选、采用、保存恢复，沿用已审BGM，安抚马无BGM，保留第一集及第二段原产物。
