# 第二集预演入口与3DGS排序修正

开发 Agent 模型：GPT6 Astra（用户指定标注）。

范围：仅修改正文采用时的资产刷新选择，以及服务端captureOnly的Spark排序控制。第一集成片、原音轨、已有素材、计费规则、默认顾问采用路径均不改变。

## 真实问题与修正

- PREVIS-SORT-01：已部署ed1cc774的48帧探针仍报`Only one sort at a time`。Spark0.1.10的构造器在展开options.view后硬写autoUpdate:true，传入view配置不能关闭自动排序。改为实例创建后调用defaultView.setAutoUpdate(false)，注销autoViewpoints中的自动排序注册（直接写属性仍不生效），仅captureOnly。保留显式prepare等待和异常拒收。原交互预览继续自动更新。
- STORY-ADOPT-01：正式第二集优化稿仍为草稿，唯一确认按钮会进入文字模型更新设定并可能重出图片。新增“仅写回本集，复用现有资产”，显式传refreshAssets:false；原付费按钮传true，顾问/批量采用仍默认true。两路均先执行原IDB快照、来源/忙碌检查、原稿保留和采用事务，再进入分镜复核。

## 双向追链

正文入口→编辑快照→prepareManualEpisodeEditAdoption→persistAdvisorRewriteAdoptionWithSnapshot→writerPack/blocks/edges/overlay及writerSession→后续分镜/previs。反查新writerPack来自同一edit，资产刷新只能在options.refreshAssets为true时触发；false路径无新模型请求。已有生成产物的失效/归档仍由原采用事务处理，旧资产保留。

捕获入口renderManhuaStageAnimation→buildSrcDoc(captureOnly:true)→SparkRenderer实例→关闭defaultView自动排序→renderFrame逐帧prepare→ffmpeg→frames/probe/result持久化。交互iframe不进入该关闭分支。反查输出帧与原GLB/frames摘要保持一致；没有绕过错误或白名单/归属校验。

## 验证

- 编辑器真实浏览器测试3项通过：长正文、集/项目隔离、恢复、忙碌/过期保护、拒绝采用，以及两个按钮的refreshAssets传递。
- 采用/场景来源/段绑定回归15项通过。
- TypeScript noEmit exit0。
- Vite build成功，1m2s，存在既有大chunk提示。
- r4实际48帧失败回执：post-prod/1/isolated-probes/ep2-stage-animation-r4-1008-1791397550864；frames complete=true，errors为Only one sort at a time。
- r5直接改属性仍失败；r6改为setAutoUpdate方法，使用修正代码、相同自有GS与原48帧夹具，在原performance4vCPU/8GB工作机执行，r6实际成功：requestId 6db36968-0cf6-444e-b5f0-5000363827ba，720×1280、24fps、48帧、2秒、315950 bytes，完整frame/probe/result/execution原始证据已持久保存，执行后queued/running为空。该探针不是正式第二集预演。

## 分层完成状态

需求/入口/生产/转换/副作用/存储的代码追链已验证；相关自动测试和构建已验证。真实付费入口不重跑；新增仅写回按钮未部署、未在线上点击。真人马动作接触、正常速度及逐帧审片、BGM混音、正式采用保存恢复仍未验。完整第二集可播放预演尚未交付。

用户在2026-10-08本轮最新消息授权主代理继续修复、合并并线上测试；只适用于本批修正，合并前仍核对真实任务、部署与CI。不得新增视频模型调用或重复购买素材。
