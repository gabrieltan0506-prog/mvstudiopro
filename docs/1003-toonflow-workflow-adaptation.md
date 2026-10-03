# Toonflow 借鉴与漫剧工厂补缺（2026-10-03）

本批基于已合并的 PR1655 / f2e1c571，在独立分支 feat/toonflow-workbench-1003 开发。全部为本机开发验证，尚未发布、未用真实小说调用模型，不能当作线上验收。

## 已实现

| 缺口 | 本批行为 | 保留边界 |
| --- | --- | --- |
| 小说原文无法直接进入编剧：旧入口只识别「第N集」，brief只有2000字 | 在既有编剧页增加折叠小说入口；EPUB/TXT/Markdown/粘贴原文，识别章回、全角数字、Markdown与英文Chapter；选择连续章节并预览完整选段 | 原文上限40万字符，一次选段上限2万字符，超限明确拒绝、不截断；未选章节不发送；不自动生成 |
| 改编来源无法随剧本追溯 | 选段独立通过现有扩写接口传入；服务器计算SHA256，按集冻结选段与来源；模型须给每集原文对照，缺失则不扣点；对照放片尾钩子之后，避免混入拍摄正文 | 原文对照是待审模型输出，不是自动事实核验；源指纹证明文本版本，不证明改编忠实度 |
| 刷新、局部改写会丢来源 | 沿用writerSession与手动备份；恢复保留小说草稿及逐集来源；局部改写保留前面旧集自己的来源；本机保存失败显示提示 | 不新建独立知识库；云备份依然由用户点击，不自动上传全文 |
| 漫剧分镜列表无搜索 | 镜号精确匹配、人物/动作/对白关键词、方向键/Enter定位、Esc清空、切集清空；保留原始索引 | 不改生成范围、镜头顺序、原稿或节点ID；自由画布原有搜索继续保留 |
| 一个高级面板报错可能拖垮整个页面 | 人物建模、白模、3DGS分别套现有React错误边界，局部恢复 | 仅渲染/lifecycle错误；不涵盖所有WebGL/异步故障，不重新提交生成 |
| 已出齐仍显示大号「补齐0张」按钮 | 改为紧凑静帧已齐状态，保留手动重出当前镜入口 | 数量齐全不等于版本审核通过，不隐藏原有版本待核对提示 |

## 与 Toonflow 的关系

官方仓库：[HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app)。已核当前 v2.0.3 / f37b7728f3cedfe6d7d64109a1aba47afafd1da8，根许可证 MIT。旧版 v1.1.8 / cd3e7c4e83963bea255be2e621eb78d2cd1c2188 的根许可证为 Apache-2.0，不能混称。此批是工作流理念的独立实现，没有复制其组件、安装应用或新依赖、导入凭证。

- [v2节点搜索](https://github.com/HBAI-Ltd/Toonflow-app/blob/f37b7728f3cedfe6d7d64109a1aba47afafd1da8/apps/web/src/pages/workspace/panels/canvas/components/nodeSearch.vue)：关键词、键盘、定位，应用到我们的漫剧分镜列表。
- [v2局部节点错误](https://github.com/HBAI-Ltd/Toonflow-app/blob/f37b7728f3cedfe6d7d64109a1aba47afafd1da8/apps/web/src/pages/workspace/panels/canvas/components/remoteNode.vue)：借鉴局部恢复，使用我们已有的ErrorBoundary。
- [v2输入与剧本工作流](https://github.com/HBAI-Ltd/Toonflow-app/blob/f37b7728f3cedfe6d7d64109a1aba47afafd1da8/packages/skills/workflow/references/sourceAndScript.md)：选定完整原文范围、追踪改编事实、区分原著与提案。这是工作流文档，不能据此声称有自动化事件库。
- [v1章节事件生成](https://github.com/HBAI-Ltd/Toonflow-app/blob/cd3e7c4e83963bea255be2e621eb78d2cd1c2188/src/routes/novel/event/generateEvents.ts)、[逐章处理](https://github.com/HBAI-Ltd/Toonflow-app/blob/cd3e7c4e83963bea255be2e621eb78d2cd1c2188/src/utils/cleanNovel.ts)、[编剧工具读取事件和原文](https://github.com/HBAI-Ltd/Toonflow-app/blob/cd3e7c4e83963bea255be2e621eb78d2cd1c2188/src/agents/scriptAgent/tools.ts)：适合作为后续长篇章节事件索引参考。该路由立即返回「成功」只是开始异步处理，不证明全部完成，不能替换我们的持久任务队列。
- [v2工作区UI](https://github.com/HBAI-Ltd/Toonflow-app/blob/f37b7728f3cedfe6d7d64109a1aba47afafd1da8/apps/web/src/pages/workspace/index.vue)：画布/文档分区、按当前选择显示工具、助手面板可收起。已查看官方canvasLight截图和工作区、3D导演台源码，未安装运行Toonflow实测。

## 已有能力与后续缺口

我们的分集剧本、资产锁定、分镜与节点、视频任务、版本采用、白模、3DGS、后期与交付已有实现。此批复用这些链路，不引入Vue/Bun/Electrobun、另一套API密钥或浏览器实时录像。Toonflow的3D导出采用captureStream(30)/MediaRecorder，受可见窗口、设备实时速度和100MB上限影响；不能替代现有服务端白模与3DGS版本约束。

尚未实现：整部小说的持久章节事件库、逐章提取任务及恢复、跨卷人物/伏笔索引、已改编章节覆盖状态、自动语义忠实度核验。现有接入是选段改编流程，不宣称整部长篇一键成片。纯文本章节标题识别是启发式，用户须用完整原文预览确认范围；无法识别按全文处理。EPUB按书内spine分节，不把spine数量冒称小说章数；不执行图文知识卡的逐页提炼。

## 验证与发布边界

- 原文CRLF/前言/中英章节无损覆盖、超限拒绝、2千字brief之外独立原文、解析对照不混入正文、会话恢复、局部改写来源保留。
- 实际React组件离线浏览器：选段启用/关闭、超长粘贴保留原稿；真实工作台搜索不改变任务或镜头顺序；局部错误恢复不生成。
- 43项相关测试通过；TypeScript与前端生产构建通过；本机CUA查看分镜搜索/第12镜同步、小说第二章选择与完整原文预览。测试用虚构文字，不调用付费模型。
- 仍须发布后在真实工作流验证保存/恢复和一笔获授权改编。没有用单测、构建或示例预览冒充线上验收。
- PR1655已经合并，不能把此批改动追加进同一张未合并PR；18:43用户已明确授权「允许集中开后续PR，先不合并」；据此集中发布后续PR，不合并、不直接推main。

## EPUB、模板库与字幕字号补充（18:41）

- 共用既有知识卡的 OPF / manifest / spine 解析 `shared/epubPackage.ts`；知识卡继续PDF打印与提炼，小说在浏览器直接读取XHTML文字/图注，不上传整书、不执行图片OCR或付费调用。现有知识卡真正Chromium分片打印/PDF合并测试通过。
- 小说保留显式节界及插图未识别提示；会话恢复按连续覆盖范围验证，文本编辑后重新识别标题。缺章节、格式错误、超限时明确失败并保留旧稿，无静默截断。EPUB≤64MiB、单文本项≤2MiB、草稿≤40万字符；仅UTF-8 XHTML，未支持扫描/加密/非标准HTML书籍。
- 用户《中华民族神话与传说（上下卷）》本机实际React文件上传验证：79个书内分节，218273字符，187处插图未识别；可选「女娲补天（华夏—汉人）」3687字符，原文不混入前一节，JSON会话恢复一致。书籍本体/全文不提交Git。开发证据 `../toonflow-evidence/epub-book-import.json`，不冒称线上或模型改编完成。
- 用户提供的紫禁城精华版PDF上传超过工具32MiB限制；改为只读其Downloads同名40717253字节PDF，14页，查看前3页，确认是知识压缩+时间线/关系图/空间图解的成品，仅作流程对照，未当原著。
- 正式登录页实际模板目录80个，已选A349「噩耗之后的第一步」，侧重反应与停顿/声音牵引；只读展开查看，未改选择、未试写。用户说明模板库包括真人剧与漫剧。现有publicTemplateId→approved服务端完整策略→扩写调用沿用；本次明确原著负责事实因果，模板负责节奏、情绪、对白/视听方法，两种来源均可复用，最终画风以本项目为准。未复制或改动库内80个模板，也未声称逐一读取完整模板。
- 用户验收字幕烧录成功、时间轴差异可接受，但字体过小。发现PostProdSubtitleCard固定传fontSize=8覆盖后端16默认；改为8/12/16三档、默认12（放大50%）并提供字号示意。保持白字细黑边、既有时间码与音轨；示意不冒充真实烧录预览。未重烧整片、未修改已完成成片。
- 新增离线浏览器验证字幕三档实际提交8/12/16，原素材与SRT不变；模板与完整原文并存、EPUB覆盖/恢复/错误保留、既有PDF转换通过。最终TS通过、Vite生产构建通过（24.63秒，既有大chunk警告）；正式部署、真实小说付费改编以及放大字幕效果仍未验。
