# 本集图片复用到普通视频节点（施工中）

## 改前证据与范围

| 检查项 | 真实证据与本次边界 |
| --- | --- |
| 最终结果 | 原页面已保存十张参考，普通视频节点能手选其中常态、变身与阿菁图片，真实请求消费所选图；随后进行已授权的三段十秒试片。 |
| 允许／禁止 | 修复现有资产复用链；不更改原二十九镜剧本、不自动认领或确认 canon、不改变引擎、价格、权限、API、schema；不删除旧图片或重做已成功任务。 |
| 入口与生产者 | OmniCanvas 的 customAssetRefs 来自上传／编辑任务及本机恢复；三个 FreeformCanvas 调用均未传入它。只为手动普通视频节点提供显式选择，工厂 clip/keyart 仍走原门禁。 |
| 转换与消费者 | Freeform 上传仅写首图；canvasRunBlock 的 stillPool 实际读取 refImageUrl + editFusionUrls，并非整个 uploadedAssets。新选择直接使用这两个既有字段。 |
| 存储／恢复 | handleBlocksChange → saveCanvasState；本机 normalizeCanvasBlock 融合图上限十五，云 sanitize 十六，取较小合同：首图＋十五附图。云恢复 uploadedAssets 为空，因此选择态从首图／融合图的对象身份反查，不依赖上传列表。 |
| 长开与签名 | 本机恢复可能为 blob，云恢复可能为 /api/canvas-media；Seedance 不会统一重签。复用 refreshAssetImageUrl，在普通节点运行前从当前资产身份取 HTTPS 新签名；失败不提交生成。 |
| 计费／权限 | 选择只改本机字段，不生成不扣费。继续走原 runCanvasBlock、api/jobs、canvasVideoTask 与账本退款。现有 materialReadUrl 仅登录＋桶白名单，不宣称已验证逐对象所有权；本次不改权限合同。 |
| 旧产物／失败 | 选图不写输出、任务号或账本；运行失败沿原错误路径，旧输出保留。空 refs、非普通视频节点保持原状。 |
| 验证计划 | 有序双图真实请求、上限拒绝、首图移除、签名变更、blob/稳定地址恢复、缺源拒绝、云往返、原图不变、类型/回归/构建与完整 diff；发布后从原页面真实选图追到任务及成片。 |
| 已知断点 | 原文件选择器未打开；这是工具与浏览器上传路径断点，不将假上传当作成功。当前还没有三段试片。 |

## 改后双向追链

- 正向：三个 OmniCanvas 挂载点传同一 customAssetRefs → 普通视频节点“已有资产”显式点击 → toggleProjectVideoReference 按次序写首图／附图 → handleBlocksChange 保存 → 运行前 prepareProjectVideoReferences 识别同一对象并复用鉴权续签 → canvasRunBlock 的 stillPool → 最终 POST 的 imageUrls。两图测试断言实际请求顺序和 duration=10，并断言旧 outputUrl、原引用不变。
- 反向：最终请求的两张新签名图 → 临时运行首图／附图 → 当前 refs 的 gcsUri → 原上传／编辑资产。恢复后不依赖已清空的 uploadedAssets：本机 blob、云稳定链、签名变化均按对象身份重新对应；十六图经过 normalize → cloud save → restore 数量仍十六。
- 三处挂载均接入；clip、omni_edit、final、keyart 和重拍节点排除，工厂认领和编译不改。空 refs 沿原路径。待审图、文生模式、两图模式、九图／本机十六图上限均关闭式处理；接力尾帧若挤掉手选图，在最终截取前拒绝，不发付费请求。
- 异步预检两次同步 Set 检查防止编译器 await 前后同帧双击；预检期间不将节点存成 running。每张续签前和全部返回后检查账号／资产集／挂载状态；提交前检查节点文字、图片、模型、画幅、视频／音频、秒级分镜、剪辑区间、运镜与连线快照。

## 验证回执（本地）

| 命令／检查 | 原始结果 |
| --- | --- |
| pnpm check | 初轮与最终改动复跑均退出 0。 |
| pnpm exec tsc --noEmit --incremental false | 退出 0。 |
| pnpm build / pnpm exec vite build | 均退出 0；前端 3560 modules、built in 1m 57s；仍有仓库既有大 chunk 警告。 |
| 相关七文件 vitest（新增 helper、pilot、Wan、H3、cloudDraft、canvasDramaStudio、manhuaSeedanceLayout） | 7 files passed / 160 tests passed。此后新增取消预检用例独立通过。 |
| 选择器真实离线浏览器 | 1 file / 3 tests passed，点两图、移除首图、云恢复和禁用态；内存图、全部网络拦截，没有生产调用。 |
| pnpm exec vitest run（全仓并行） | 538 passed / 6 failed / 2 skipped files；5235 passed / 6 failed / 4 skipped tests，263.14s，退出 1。 |
| 上述超时项独立重跑 | 5 files / 33 tests passed，24.88s（含新 helper 和浏览器、资产费用及编辑输入、pilotReview）；真实 FFmpeg 1 file / 10 tests passed，14.32s。未改超时参数或旧测试。 |
| 全仓剩余失败 | 两项原生深读 CLI 的 7201 上限断言；与 origin/main 对应源码／测试 diff 为空，冻结学习链未改。 |
| git diff --check 与完整源码／调用点 review | 退出 0；两个独立审查发现（尾帧挤图、omni_edit 旁路）已落实并回归。 |

## 分层状态审计

| 层 | 状态与证据 |
| --- | --- |
| 需求／边界 | 已验证：原页面仍十张图，原二十九镜／一百三十秒剧本只读核对；不覆盖、不确认空 canon。 |
| 入口／交互 | 本地已验证：三个调用点与真实离线点击；正式页面待验。 |
| 数据生产 | 部分完成：真实资产已在原页面；本地夹具证明选择生产非空字段，尚未线上点新入口。 |
| 契约／转换 | 本地已验证：首图／附图、十六图持久化、签名／blob／稳定链对应、模式容量。 |
| 服务／副作用 | 部分完成：实际 runner 在离线网络边界断言两图、十秒、超限零 POST；线上扣费／退款未实跑。 |
| 存储／恢复 | 本地已验证：云往返仍十六图；线上刷新恢复待验。 |
| 消费／展示 | 部分完成：真实组件和请求通过，最终视频尚未产生。 |
| 静态／回归 | 部分验证：类型及构建通过；全仓两项既有失败仍保留。 |
| 真实链路 | 未做线上实跑；不能将离线回执称为视频生成或质量验收。 |

## 残余范围

现有 materialReadUrl 只有登录与桶白名单，不是逐对象所有权校验，本次没有扩改权限模型。文件选择器本身未改；新增入口复用已有项目图片。本次接线施工没有新增生产付费调用；此前的已成功图片任务保留。尚未验收真实三段视频和后期成片。正式发布、原页面与账本回执在后续追加，不以本文代替验真。
