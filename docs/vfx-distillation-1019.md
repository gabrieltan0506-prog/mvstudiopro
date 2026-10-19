# 三模板特效入库与配音确认修复（2026-10-19）

状态：开发链路部分验证，未部署、尚未线上验收。

## 需求与改前证据

用户授权三份指定 HTML 全量提炼可复用特效，修复刚遇到的问题，集中推送一个 PR，不合并。未授权新媒体或付费生成。本批保留原 106 条，新增 50 条；12 个通用机制映射旧条目。配方是给既有视频链使用的导演文字与制作建议，不是新增 50 个渲染器。

| 层 | 真实入口及约束 |
|---|---|
| 入口 | ManhuaScriptWorkbench 当前镜 → ManhuaVfxPicker；搜索、翻页、改写、明确采用 |
| 生产者 | manhuaVfxDistilled 的起因、轨迹、接触、结果、制作方法、限制；旧目录 ID 不变 |
| 转换与保存 | formatManhuaVfxDirection → upsertManhuaShotVfx → clip.prompt 的用户补充区；JSON恢复与 mergeManhuaDerivedClipPrompt 保留原文 |
| 消费者 | canvasDramaStudio: ensure 派生提示；canvasRunBlock: compileI2VMotionPrompt → stripManhuaPromptSlop → 光学附加/URL剥离 → 视频请求 |
| 长文本边界 | 含已采用特效且超过8000字时明确失败，不再静默切掉末尾特效；不改无特效旧稿契约 |
| 配音生成 | DigitalHumanStudio 捕获完整台词/声线/演法 → 页内确认 → 先保存请求再沿旧 dialogue 服务执行；原计费、幂等与错误恢复不变 |
| 原结算 | 原 request 通过另一确认入口恢复；不创建新 requestId、不重生成 |
| 确认生命周期 | owner/项目/段落/正文/声线/演法/克隆状态变化取消；卸载、Escape、取消拒绝；同帧多击只接受一次 |

## 来源及审图边界

三份来源的 SHA256、帧说明和稳定配方 ID 对应在 `vfx-distillation-1019.json`。所有机制源自报告；制作方法为本轮推导建议，不能当原片幕后工艺证明。

| 报告 | 实际镜头表行数 | 截图卡 |
|---|---:|---:|
| matrix.html | 227 | 286 |
| inception.html | 274 | 298 |
| minority report.html | 250 | 210 |

报告标题所称1358/1783/1408镜不是HTML内的实际镜头表行数。已提取全部文本、截图说明与表行，按机制查重；人工查看78个相关静帧。存在配图与文字错位，已记录具体项。未审看原片连续运动，不声称全片每帧或每个未展示特效均已核验。原图仅本地审阅，未打包入仓库或作为生成参考。片名与原角色名不进入产品配方及外发提示词。

## 新增机制索引

| 名称 | ID | 来源报告 |
|---|---|---|
| 纵向代码雨与空间显影 | `vfx-hologram-code-rain` | matrix |
| 穿入符号的空间转场 | `vfx-portal-symbol-dive` | matrix |
| 嘴部表皮连续闭合 | `vfx-organic-mouth-seal` | matrix |
| 微型机械虫展开与附着 | `vfx-mechanical-insect-deploy` | matrix |
| 液态镜面沿接触蔓延 | `vfx-fluid-liquid-metal` | matrix |
| 反射像漏斗形扭曲 | `vfx-illusion-mirror-funnel` | matrix |
| 屏内城市球面畸变 | `vfx-environment-sphere-world` | matrix |
| 纯白空间加载与场景切换 | `vfx-portal-white-load` | matrix |
| 腾跃踏墙与跨楼落地 | `vfx-impact-wall-run` | matrix |
| 多足巡逻机与触手探入 | `vfx-mechanical-sentinel-tentacles` | matrix |
| 激光沿壳体切缝 | `vfx-mechanical-laser-cut` | matrix |
| 弹着点逐次剥落立柱 | `vfx-destruction-column-strike` | matrix |
| 狭长井道定向火焰喷涌 | `vfx-destruction-shaft-fire` | matrix |
| 弹道空气折射波纹 | `vfx-time-bullet-refraction` | matrix |
| 飞行物减速悬停再坠落 | `vfx-time-projectile-hold` | matrix |
| 由内透光的形体解体 | `vfx-illusion-inner-light-fracture` | matrix |
| 电弧环形脉冲与设备熄灭 | `vfx-energy-emp-ring` | matrix |
| 液面隆起为几何实体 | `vfx-fluid-metal-emerge` | matrix |
| 洪水破窗灌入室内 | `vfx-fluid-window-flood` | inception |
| 局部爆散悬停与人物常速 | `vfx-time-suspended-fracture` | inception |
| 书摊纸页爆散悬浮 | `vfx-destruction-paper-burst` | inception |
| 果摊分材质碎裂 | `vfx-destruction-fruit-burst` | inception |
| 街区沿铰链翻折 | `vfx-environment-hinged-city` | inception |
| 双镜闭合形成无限纵深 | `vfx-environment-mirror-corridor` | inception |
| 视点限定的循环阶梯 | `vfx-environment-impossible-stair` | inception |
| 走廊重力转向搏斗 | `vfx-environment-gravity-roll` | inception |
| 多人失重与牵引转运 | `vfx-time-zero-gravity-group` | inception |
| 液面倾斜提示重力变化 | `vfx-uncanny-gravity-liquid` | inception |
| 大型载具闯入既有街道 | `vfx-impact-intruding-train` | inception |
| 路面波浪翘裂 | `vfx-destruction-road-heave` | inception |
| 海岸巨构逐段崩塌 | `vfx-disaster-coastal-collapse` | inception |
| 雪崩前锋与山坡追逐 | `vfx-disaster-avalanche-front` | inception |
| 多空间事件分时同步 | `vfx-time-layered-trigger` | inception |
| 手势拆分与重排影像时间轴 | `vfx-hologram-gesture-timeline` | minority |
| 空间中的人物记忆投影 | `vfx-hologram-recorded-presence` | minority |
| 识别触发的环境广告 | `vfx-hologram-identity-ad` | minority |
| 垂直轨道车流转向 | `vfx-environment-vertical-traffic` | minority |
| 喷气背包受力与窄巷飞行 | `vfx-mechanical-jetpack-flight` | minority |
| 声波定向压缩冲击 | `vfx-energy-sonic-pressure` | minority |
| 机械流水线包围组装 | `vfx-mechanical-assembly-line` | minority |
| 感应藤蔓缠绕与释放 | `vfx-organic-reactive-vines` | minority |
| 微型机械群搜查与眼部扫描 | `vfx-mechanical-spider-search` | minority |
| 破碎主观预视与回放对照 | `vfx-memory-forecast-fragments` | minority |
| 机械雕刻与实体凭证出料 | `vfx-mechanical-automated-token` | minority |
| 金属细柄连续弯曲 | `vfx-mechanical-spoon-bend` | matrix |
| 同位置人物形态替换 | `vfx-illusion-identity-replacement` | matrix |
| 玻璃幕墙冲击起伏后碎裂 | `vfx-destruction-glass-wave` | matrix |
| 人物蓄力后垂直飞升 | `vfx-impact-powered-ascent` | matrix |
| 杯体接触碎裂与液体飞溅 | `vfx-destruction-cup-fracture` | inception |
| 记录投影条带失真并结束 | `vfx-hologram-projection-breakup` | minority |

## 双向追链与状态

- 正向：真实Picker选择新配方并采用；50条配方经补充区、JSON恢复、系统重编译和真实外发转换函数，制作方法与结果均保持非空。
- 反向：外发制作方法可追到稳定配方ID，再到本次报告SHA及原帧说明；来源元数据不进入外发正文。
- 未改计费/API/schema/队列/模型路由；未触发媒体或生产请求，旧音视频回执保持。
- 配音页内弹层复用真实确认hook做离线交互验证；完整数字人线上页、真实扣费/退款及最终视频质量未实跑。
- 其他原生确认、媒体链接导航、云稿等待未在无证据时扩大修改。

## 验证记录

- 第一轮5文件16项通过：目录、补充层、新配方、Picker离线组件、费用确认离线组件。
- 后续外发链4项通过：50条制作方法均通过实际外发转换，超限明确拒绝。
- `pnpm check`最终补丁通过（退出码0）。`pnpm exec vite build`最终源码构建通过（29.60秒），有既有大分包提示。
- 受影响旧路径回归142项中140通过、2失败：`video_extend`旧源视频引用期望不符；灯光库旧测试期望8条、实际28条。在HEAD cfd415f的独立git archive基线中定向复现同样2项失败，未改相关逻辑或以改断言掩盖失败。首次基线启动早于解包结束，报No package，解包完成后定向运行得到上述真实基线结果。
- 未启用或修改远端工作机；未做Fly隔离探针、生产浏览器验收或付费视频验收。不能用离线通过替代上述未验边界。
