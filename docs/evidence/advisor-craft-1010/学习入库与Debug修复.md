# 学习入库与Debug修复

开发 Agent 模型：GPT6 Astra（用户指定标注）。

状态：7项定向验证、类型检查与生产构建通过，正式线上尚未验收。用户已自行将第14集成功批准，本次不重学、不重新批准、不修改现有成果。

## 已取得证据

- 用户保存的报告 `/Users/tangenjie/Downloads/2026Oct10/百花殺14.html`：8322456字节，标题“第14集逐帧审片手记”。这是成功导出的报告，与失败HTTP请求的HTML错误页是不同对象。
- 原正式页面Mutation日志：`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`；旧提示函数把JSON解析失败统一改为“算力紧张或请求超时”。原失败请求的HTTP状态及HTML错误页未捕获，不能断言唯一上游根因。
- 用户再次点击后，23:56:10北京时间，`manhuaViralTemplate.approve`返回HTTP200、JSON、ok=true，卡片`tpl_native_5bf6be0bf3d9-g38f_ep014`状态approved。其间代理无线上修改或部署。这证明本次实际入库成功，不证明本修复已上线。
- Fly服务端只读对照：12集新待审卡仍proposed，正式卡为9月27日旧版本；14集批准前为proposed、正式卡不存在；两张待审卡均8段、必填摘要校验通过。不能将旧12集正式卡等同本轮新学习成果已批准。

## 改前与改后追链

| 层 | 检查与结果 |
|---|---|
| 需求/边界 | 修批准请求传输与真实错误可见性；不重新学习、不改入库权限、计费、GCS内容 |
| 入口 | PlatformPage批准普通/修订卡均使用同一tRPC mutation；只发送id与确认标志 |
| 数据生产 | main.tsx的原HTTP传输与Query/Mutation错误事件记录错误；不从toast反推原因 |
| 转换 | 批准接口加入已有Fly直连名单，其余路由原样移动到可测试模块；原HTTP响应原样交给tRPC解析 |
| 服务 | 原Fly健康检查、credentials include、后端权限/锁/校验不变；新诊断不会额外重试 |
| 存储 | 错误仅留当前页内存30条，刷新清空；不存输入、认证头、完整响应页，不改变GCS |
| 消费 | 原有权限与Debug开关下显示接口、HTTP、Content-Type、脱敏原始错误；关闭Debug仍捕获 |
| 静态/回归 | 5项错误记录单测、1项真实tRPC路由测试、1项React浏览器交互测试通过；pnpm check退出0，Vite构建1m20s退出0（既有chunk体积提示） |
| 正式链路 | 已有用户第14集实际成功入库；本修复未部署，未做新版本线上验收 |

正向：批准按钮→tRPC分流→既有鉴权Fly→原批准服务→原响应/错误→诊断内存→Debug。
反向：Debug每条由原传输HTTP状态或tRPC原始error产生，不使用通用toast文案；同一approve接口及卡id沿用原服务，诊断不写卡片。

## 验证

- `pnpm exec vitest run client/src/lib/apiDebugErrors.test.ts`：5 passed，含HTML/非JSON、200错误页、原响应可读、业务/网络错误、凭证脱敏与有界记录。
- `pnpm exec vitest run client/src/lib/apiErrorDebug.browser.test.ts client/src/lib/trpcTransportRouting.test.ts`：2 passed，真实React关闭后打开可见/清空无提交，真实tRPC批准直连失败一次不重发、显式第二次成功。均为本地模拟响应，不调用生产学习。
- 未做Fly隔离机、Production新版本提交；不把模拟网关错误称为历史实际网关原因。

- 完整本次差异主审：原路由集合逐项保持，仅新增approve；原按钮普通/修订均走此接口；两种fetch及Query/Mutation错误均接入，响应原样消费、错误原样抛出，Debug不调用批准/重试。未改后端鉴权、计费、存储或媒体。
