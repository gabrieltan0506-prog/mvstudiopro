# Claude Code 接手：函数分流与 GLM 冲突 schema

交接时间：2026-09-06 22:55（北京时间）。状态：**部分验证，未线上验收，不能视为可直接合并的生产修复**。用户已要求停止扩展施工，写交接由 Claude Code 接手。

## 1. 用户最终要求（优先于旧实验做法）

1. 单片原稿如果一次通过，直接保留完整原稿，不交给去重函数处理。
2. 只有单片发生重试，才把该片的两到三份完整稿交给函数去重、保留有效内容。
3. 四片准备齐后，一次把四片 JSON 交给 GLM 做整集整形，不能逐片/分批分别调用 GLM。
4. 多稿冲突处理不能只写提示词：schema 必须承载来源、处理状态、结果、依据、未解决原文，并有程序验收。
5. 取消额外视频标注、重编码、完整解码验帧等工序。拉片一次、281秒复制切片、原有读片；不能再加昂贵预处理。
6. 用户要求相关验证和类型检查，由用户自己合并；最初没有授权远程动作；交接末尾用户追加明确授权“推送以后你不用管了”，当前按该指令提交并推送此功能分支。不创建PR、不合并、不部署。
7. 已中止的 GLM 不能假装可以续接；新付费调用没有得到这轮授权，不要自动重跑。
8. 用户强烈不满耗时与反复纠正。接手优先审查现有差异和断点，不重做视频，不扩大设计，不用报告冒充实测。

## 2. 精确位置与 Git 状态

仓库：`/Users/tangenjie/Documents/Codex/2026-09-06/new-chat/work/learn-html-local-download`

分支：`fix/learn-gates-ten-percent-0906`

HEAD：`d81a3aa1db8c5def2d4f6c7c2048dca2d69c8f02`

已跟踪修改：
- `server/services/bailianChat.ts`：增加显式 `requireResponseJsonSchema`；开启时 OpenRouter/套餐 Qwen 发 `json_schema strict`，不支持的通道在发包前拒绝；OpenRouter要求参数支持，保留原provider锁。
- `server/services/manhuaNativeDeepReadRunner.ts`：`invokeNativeDeepReadGlmStructuring`增加可选`prompt.boundaryEvidence`，生成冲突schema/提示词并传给网关；新返回与恢复结果都校验。
- `server/services/manhuaNativeDeepReadGlmEvidence.ts`：强制schema请求恢复时对比schema，旧的普通请求仍保留原有兼容行为。

未跟踪文件（`git diff`不显示这些，审查必须打开）：
- `server/services/manhuaNativeBoundaryExperiment.ts`：早先实验模块，本轮在末尾增加`prepareBoundaryStructuringBatch`；单稿直接复制完整annotated原稿，重试稿按片执行去重。此文件仍包含用户已经取消的旧标注实验函数，只是新入口不调用，不能把它们重新接回生产。
- `server/services/manhuaNativeBoundaryExperiment.test.ts`：早先18个实验测试。
- `server/services/manhuaNativeBoundaryContract.ts`：本轮新增schema、冲突组生成、返回结构/来源/未解决原文/状态对账。
- `server/services/manhuaNativeBoundaryContract.test.ts`：本轮8个测试，含首发单稿保留、单片三稿处理、四片组装、runner持久化顺序和网关真实请求体构造（fetch为测试替身）。
- `scripts/probe-native-boundary-schema.mts`：新实验入口草稿。读007既有永久JSON，四片一次调用。**尚未运行、未上传Fly；pnpm check不包含scripts目录。**
- `outputs/`：已有探针产物及本交接日志，不要整目录误提交、覆盖或删除。

**重要：正式生产入口目前没有传入`boundaryEvidence`，新契约只在实验入口显式启用。不能声称普通产品按钮已接上。用户是否要求正式生产接入，需要结合其接手指令确认范围。**

## 3. 已实现的代码行为与剩余断点

新分流函数：`manhuaNativeBoundaryExperiment.ts:766`。同段只有一稿则保留`bundle.annotated`完整内容（仅附来源元数据，不做事实去重），两三稿才执行函数。测试断言四段中0/2/3原样保留、仅第1段三稿进入函数、仍输出四个rawSegments。

新契约：`manhuaNativeBoundaryContract.ts:164`。正文五种记录强制`_sourceIds`与`_sourceAlternatives`，顶层强制`_unresolvedEvidence`与`_conflictResolutions`。冲突图连通候选组成组；每组要求groupId/sourceIds/status/selectedSourceIds/reasonZh。未解决项必须保留row，逐原文字段对账；不能只丢一个编号或将尚未解决的来源标resolved。

模型取舍的真实性依然不是schema能够证明的。当前程序校验来源、字段、状态闭合，**不等于已证明哪份稿事实正确**。测试中保留另稿原文的resolved只证明可追溯结构，不证明语义裁决正确。原先`auditBoundaryEvidenceOutput`仍有语义/父子关系等需要审查的边界，不要夸大成完整内容验收。

网关：`bailianChat.ts:800`。强制schema只在显式开关下发出，默认生产请求不变。不支持的fallback拒绝，不退回json_object冒充约束。OpenRouter仍锁定原Z.AI provider，不擅自换供应商。

**供应商能力未真实验证**：OpenRouter模型页介绍支持schema，但原生Z.AI文档主要是json_object；当前严格schema是否被锁定的Z.AI端点接受，尚未实跑。且原schema有可选属性，需核实该端点strict子集是否要求所有properties进入required。不能以本机fetch替身通过，声称上游保证结构约束。相关官方入口：
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/z-ai/glm-5.3
- https://docs.z.ai/guides/capabilities/struct-output

**没有修改15分钟超时**。当前新草稿仍继承原网关的15分钟override，不能直接再跑然后到点中止。用户已明确对未经说明的自动中止不满；如后续授权新调用，先把实际有效超时与处理策略落实，不能只看总timeout=30分钟。

新脚本还需审查：
- 默认模式会保存函数/请求预览，但不发模型调用；`--execute`才发一笔。
- 来源固定007，输出独立`pull-split-0906-007-schema-v1`前缀和新callId，独占启动标记，不能复用覆盖旧付费证据。
- `glm-request.json`是预览，最终真正带schema的请求在runner evidence/request中；不能拿预览代替实际发包。
- 脚本依赖Fly现存`/app/.codex-probes/gcs-probe-io-0906.mjs`。不算可独立部署的生产脚本。
- 函数和契约组装中有重复计算，但没有重复模型调用；没有做这版真实数据性能对照。

## 4. 这轮验证原始结果

最终命令（仓库目录）：

```sh
pnpm exec vitest run server/services/manhuaNativeBoundaryExperiment.test.ts server/services/manhuaNativeBoundaryContract.test.ts server/services/manhuaNativeDeepReadRunner.test.ts server/services/manhuaNativeDeepReadGlmEvidence.test.ts server/services/bailianChat.test.ts
pnpm check
git diff --check
```

最终结果：

```text
Test Files  5 passed (5)
Tests       375 passed (375)
Duration    3.34s
pnpm check / tsc --noEmit：exit 0
git diff --check：exit 0
```

原始日志在本仓库`outputs/claude-handoff-0906/vitest-final.log`与`typecheck-final.log`。首轮类型检查曾因ES5 target不能展开Set失败；已改Array.from，以上是最终复验结果。没有隐藏首轮失败。

未执行：新schema付费实跑、完整视频语义核验、产品UI入口验收、计费/退款线上测试、正式构建/Docker、独立脚本类型检查、PR/合并/部署。提交和推送依据最后追加授权执行，具体提交见分支最新git log。

## 5. 007 已付费实验的事实，勿重复购买或误报

影片《聚宝仙盆之杂灵根才是真BOSS》，来源modal_id=7634185120418124985。下载一次，1121.849秒，1024×576，30fps，118,852,780字节。四片逻辑边界0/281/562/843/1121.849，复制切片，不重新编码。旧006曾额外烧字并发生Fly OOM；不得重做这些工序。

007四片读片已经返回，共七份可解析返回稿。旧版函数把七稿全部一起处理：964记录→957单元，仅合并7条；纯计算143.469658ms，含三份证据存储9730.239168ms；81条镜头在确定正文，568条来源记录留未解决，来源对账无丢失。这个统计属于**旧版全量函数处理**，不代表当前用户指定的分流新版本。

007 GLM只调用了一次，输入涵盖四片全部版本；不是分四次整形。北京时间22:25:35开始，15分钟到点中止；raw-1.json已经永久保存40,410,898字节，SHA256：
`94b7f58fd6cdf6c12b9790c537b2fe5e030a0fff9788bc09b33078e58940f16e`

没有最终glm-result/parsed或最终整集质量验收。报错`The operation was aborted due to timeout`，其上层通用“兜底全链失败(含Qwen末档)”措辞有误导性：本次显式gatewayOrder只有OpenRouter，**没有新发Qwen**。

用户曾要求看看截断前内容；完整流已归档，但尚未完成SSE正文/思考拆解和可恢复性检查。可以只读检查，不得把补括号后的部分JSON冒充完整成功，也不要重新请求模型补完。

事实纠正：早先口头说“提示词与旧schema冲突造成慢”不准确。实际发包GLM仅json_object，旧schema未真正下发；只确认缺少强制契约与超时处置失误，无法证明具体慢因。不要继续沿用错误归因。

## 6. 永久证据位置与安全边界

本机完整归档：
`/Users/tangenjie/Downloads/mvstudiopro-知识库/漫剧学习链路/证据/0906-拉片切片时间对齐-007/`

归档回执`archive-receipts.json`：114对象、66,989,446字节，下载逐份校验字节与SHA256；包括006旧证据、007所有JSON和007 GLM截断raw。保留全部版本，未覆盖旧对象。

关键目录：
- `pull-split-0906-007/`：read-summary-resumed.json、全部seg*-attempt*-response-original/parsed/grounded/audit、function-*、glm-request等。
- `pull-split-0906-007-glm-function/`：实际request.json与raw-1.json。

GCS相应前缀：
- `manhua-template-learn/probe-audit/pull-split-0906-007/`
- `manhua-template-learn/episode-glm-evidence/pull-split-0906-007-glm-function/`

Fly运行日志：`/app/.codex-probes/pull-split-0906-007-continue.log`，模型请求已结束。没有在途的新schema请求。

所有生产凭证只能留Fly进程；严禁下载secret、导出到本机或本机直连生产上游。原始响应和解析JSON是永久付费证据，不能随临时媒体清理。也不要误认为当前/tmp里的新版.mts就是实际执行007的脚本，007真正执行的是当时上传的旧bundle。

## 7. 九层状态审计与接手顺序

- 需求边界：已验证，以上用户最终要求。
- 入口交互：部分完成，仅隔离脚本显式接新契约；生产按钮没接。
- 数据生产：旧007真实原稿已验证；新分流只有目标测试，无新版线上数据结果。
- 契约转换：已实现且本地375项回归/类型通过；供应商strict兼容未验证。
- 服务副作用：新请求体构造与不支持通道拒发已测试；新真实调用/计费/退款未跑。
- 存储恢复：raw先存和parsed拒收已测试，schema身份纳入比较；旧证据永久归档已验证，新线上恢复未跑。
- 消费展示：新契约本地验收已实现；产品最终UI和整集质量未验证。
- 静态回归：375通过、check通过、diff检查通过；scripts不在tsconfig，Docker/正式构建未做。
- 真实链路：部分完成。旧007读片成功但GLM超时失败；新链没有付费验证。

接手先审查上述未跟踪文件和三个已跟踪diff，明确用户要继续实验还是接正式入口。保留“一次通过原稿不进函数、重试同片2–3稿才去重、四片一次GLM”这条规则。核实strict端点/有效超时并处理明确断点后，再按用户授权决定是否实跑或进入合并。不要宣称当前就是生产可交付。


## 8. 用户最后追加授权：推送后停止，原有参数保持冻结

用户原话：“推送以后，你不用管了”“记得把那些原来冻结的参数冻结”。本轮仅提交并推送本功能分支，之后停止，由Claude Code接手。不创建PR、不合并、不部署、不重跑付费实验。

原有冻结契约没有改值：原生读片MEDIUM、65536输出、无thinkingBudget、既有采样与0.7→0.65→0.6；整形原模型/路由参数、0.8温度、high思考、131072输出，以及现有超时保持原值。现有运行时deepFreezeNativeContract和原参数回归测试保留，375项通过包含原runner的304项测试。

注意：按最后“保持参数冻结”指令，本次仍保留原GLM通道15分钟override。其与先前超时投诉的后续处理不能靠接手者默默改参数；在新付费调用前需结合用户后续明确指令解决。schema强制开关是本轮明确授权新增的结构契约，不是偷偷修改其他模型参数。
