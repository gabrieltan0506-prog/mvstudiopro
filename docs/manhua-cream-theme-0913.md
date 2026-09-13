# 正式漫剧UI米白主题

用户明确要求修改实际产品代码，不止示意图。范围：/canvas漫剧模式，包括工作台/资产/分镜/动作与音轨/剪辑/成片坞及其门户弹层；不改其他页面和自由画布独立模式，不改API、数据、生成、计费或媒体像素。

改前证据：OmniCanvas以canvasMode控制模式，根部text-white/bg-transparent；ManhuaScriptWorkbench含多处写死的深底及浅字；共用弹层通过Radix portal挂到body。必须同时覆盖变量和遗留颜色，门户跟随漫剧模式，切出即恢复。

生产者：canvasMode=manhua时根DOM声明主题；转换：局部CSS变量与遗留工具类颜色适配；消费者：DOM计算样式及门户内容；存储/权限/收费：无变动，无新增持久化或请求。失败恢复沿原函数，无新增handler。校验：真实组件离线浏览器、主题进出及门户对比度、既有画布回归、类型与前端构建。正式线上验收尚未执行。

## 同批角色交互

日常创作与一次性角色准备分开；骨名、坐标和旧专业输入保留在展开区域。角色准备候选由当前项目各段的真实已保存spec/历史spec产生，先检查当前人物对应的成功3D任务版本，再复用骨映射、方向、身高和表情控制器；不会复制其他段的表演时段，不把历史候选标为质量通过。

正向：ManhuaScriptWorkbench当前资产资格→collectPreparedRigProfiles→角色显式载入→applyRigForm→父组件publish→OmniCanvas保存本段previsStudio。普通表演将明确选中的固定人物头部位置/机位转换成既有gazeTarget；移动目标或跨不同机位的时段禁选，保留旧坐标，不声称自动追踪。配置保存失败时返回false，不显示成功。

反向：生成与采用仍走既有服务；选中成功候选的spec产生motionGuideZh和previs视频引用，经setManhuaSegmentReference保存到同一clip；canvasRunBlock根据该引用附入参考视频职责及动作指引。新增交互不改队列、API、计费、权限和持久化schema。已有参考保留，可恢复；绑定模型不再被双人白模互动入口错误选入，旧互动仍可审阅或移除。

## 本机验证记录

- `pnpm check` 退出0。
- 角色/主题浏览器、creator/profiles、画布三组与共享分段回归共7文件148测试通过，Duration23.34s；服务边界明确离线，未触发生产调用。
- `pnpm exec vite build` 最终主题版本退出0，`✓ built in 17.42s`；存在既有大包警告。
- 实际ManhuaScriptWorkbench与ManhuaPrevisStudioView使用构建CSS在1440×1000浏览器渲染；根背景rgb(238,233,223)，表单字rgb(32,50,71)，scrollWidth与视口均1440。发现并修正旧深色渐变、预览区暗字，已复看修正后的工作台截图。
- 截图及原始日志保存在本机`/Users/tangenjie/Downloads/2026Sep13/正式UI验收/`。截图采用离线测试内容，不代表真实项目生产验收。新增代码文件、既有组件完整差异和下游消费者均已自审；没有子代理独立审查，不声称满足合并条件。

完成状态：源码与上述本机层已验证；正式登录、真实用户模型、生产渲染与发布后前台未验，本批仍属于部分验证。第六步自动绑骨文件不包含在本UI批次。
