# 提示词审阅参考缩略图恢复

## 改前证据

- 目标：长开页面的参考缩略图失效时，仍能通过已有本机字节或同对象续签恢复核对人物。
- 入口：工作台提示词审阅、补充指令引用；自由画布共用引用编辑器。
- 生产者：ManhuaScriptWorkbench的chipThumbByAssetId读取customAssetRefs，以资产ID映射url；提示词绑定表解析资产ID，两个组件读取同一映射。
- 缺口：ManhuaPromptAssetChips和ManhuaPromptMentionEditor都使用原生img，未调用既有恢复组件。
- 恢复：ManhuaAssetImage → 本机媒体按来源/稳定GCS身份读取 → resolveCanvasMaterialUrl → 已鉴权materialReadUrl；只更新DOM，不写原资产、节点、草稿或生成请求。
- 范围：两个显示入口，复用现有组件；不改API、计费、模型、数据结构或自动生成。失败有界，同来源只恢复一次；切换图片弃置旧异步结果。
- 验证：现有图片恢复/续签专项，补两个入口的真实JSX接线断言，类型检查；正式页面未验。

## 改后验证与边界

- 正向：customAssetRefs → 资产ID缩略图映射 → 提示词解析/引用候选 → ManhuaAssetImage → 本机读取/鉴权续签 → DOM。
- 反向：DOM图片src由两个实际JSX入口传入原thumb，组件不修改上层状态；生成和草稿继续消费原资产引用。自由画布共用编辑器同步覆盖。
- 原5文件37项测试通过；新增2项入口检查后该测试文件4项通过，累计39项不同断言通过。pnpm check最终退出0；pnpm exec vite build退出0，25.89秒，保留大chunk警告。git diff --check通过。
- 原恢复专项覆盖失败、同对象验证、旧异步退役、缓存读取及续签；新增测试证明两个真实JSX使用恢复组件，不是正式浏览器端到端验收。
- 未修改队列/worker/计费退款/持久化，不生成新资产。未正式登录页面验证、未提交或发布；生成前最终提示词一致性尚未完成调查。
