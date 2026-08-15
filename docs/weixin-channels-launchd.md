# 视频号双窗口 launchd 安装与校验

## 运行边界

- 正式采集只由一个 launchd job 启动；launcher 另用原子目录锁防止重复进程。
- 正式命令不再保存或写死 CGWindow ID。只有屏幕上恰好存在两个合格视频号窗口、
  且两窗属于同一微信 PID 时，才允许按屏幕 x 坐标自动绑定为左窗和右窗；少于两窗、
  多于两窗、跨 PID 或窗口不合格都必须失败关闭。
- 每次网页从“停止采集”切换到“开启采集”后，正式采集都会依次在左、右窗口显示
  “点击放大镜”十字星校准层；两窗校准完成后才允许操作搜索入口。
- launcher 使用 `--supervise-web-toggle` 常驻监督网页开关：停采时只待机且不触碰微信，
  重新开采时由同一本机进程恢复，不依赖 Vercel/Fly 远程启动 Mac 进程。
- 正式入口使用 `--raw-harvest` 两阶段采集。实时阶段只做播放器/评论/搜索导航的
  安全识别，机械保存五个进度帧和评论页，不做内容资格、广告或去重判断；每 20 分钟
  原子封批并更换全新的 UI 采集子进程。独立 raw worker 同时用 macOS Vision OCR 筛选
  上一批，所以 OCR、去重和批传不会阻塞新一轮采集。搜索“最新”每批最多保留 50 个 raw，
  搜索结果超过一年、广告、低热和重复项在本机淘汰，只有有效项进入现有 Fly pending。
- 视频号图片只作为本机短期 OCR/页面安全证据，绝不进入 observation JSON、Fly 持久卷或 GCS；
  服务端也会剥离旧客户端仍携带的图片字段。DeepSeek/Terra 只读取精简后的文字与指标。
- 每条 raw 视频从当前页确认到允许切换下一条之间随机停留 10–15 秒；五点截图与评论操作
  已经耗掉的时间计入停留，不会在采集完成后再固定追加 10–15 秒，也禁止连续高速刷页。
- raw 批次容量硬上限仍为 2,000 条，用于阻止异常页面造成无界磁盘增长；正常切批以
  20 分钟为准，不会等待凑满 2,000 条。封批后未完成的预约会明确记为 abandoned，只有
  已原子提交的 manifest 进入离线处理。最近两批完整素材保留用于现场审计，更旧的已完成
  批次只保留 `run.json` 与 `summary.json`，回收图片空间；pending 与处理中批次绝不清理。
  raw、淘汰项和重复项均不计有效数据，也不进入 DeepSeek/Terra 计数。单个离线批次连续
  三次无法解析时转入 `failed` 隔离态并保留素材与原因，后续批次继续处理，不能被坏批永久堵塞。
- 模型聚合沿用原有正式口径：只有 Fly 已持久化的正式、达标、有效且未消费 observation
  经本地语义去重后才参与累计。每严格满 1,000 条创建一次 DeepSeek V4 Pro 0813 八项整理；
  请求固定 `max_tokens=65536`、`reasoning.effort=medium`、JSON object 与
  `provider.require_parameters=true`，不传 temperature/top_p。输出使用字段/枚举白名单、
  40 字文风上限和 observationId 证据锁；截断、非裸 JSON、空壳或 schema/枚举越界只重试
  一次，再失败就把该批标为 `discarded`，不让脏结果下行。每累计 8 个已完成、
  尚未清洗的千条 DeepSeek 结果（即 8,000 条正式有效数据）才创建一次 Terra High 清洗。
  20 分钟 raw 封批次数、本批原始条数、本地淘汰数与 pending 数均不得触发模型。
- 左上角悬浮窗同时显示“本批原始”和“有效新增”：前者在 raw 原子落盘后立即增长，
  后者只在离线筛选通过且 Fly 确认正式新增后增长，避免把原始素材冒充有效数据。
- 采集令牌只在进程启动时从登录用户 Keychain 的 `mvstudiopro-weixin-channels-collector` 服务读取，不写入仓库、plist、日志或锁文件。
- plist 的 `KeepAlive.SuccessfulExit=false`：采集器非零退出时自动重启；网页停采、安全熔断等正常退出不会重启。
- 安装脚本会加载并立即启动 job。合并前、采集开关关闭时或双窗未验收时，只运行源码校验，不得执行安装。

## 合并前只读校验

```bash
./scripts/install-weixin-channels-launchd.zsh --check-source
```

该命令检查 shell 语法、plist、受限双窗自动绑定、正式十字星校准、raw 两阶段采集、独立离线 worker、网页开关监督、
禁止硬编码 windowId、Keychain 读取入口及 KeepAlive 契约；不读取令牌，也不修改 launchd。

## 合并后安装

先确认屏幕上只有两个待采集的视频号独立窗口，且它们属于同一微信进程，再执行：

```bash
./scripts/install-weixin-channels-launchd.zsh --install
./scripts/install-weixin-channels-launchd.zsh --check
```

## 零 token 本地 watchdog

watchdog 每 15 秒检查本地单条采集活动文件，并用 Fly heartbeat 确认网页开关；正常状态不调用模型。
任一视频从资格采集开始到 Fly 最终确认超过 60 秒，会记录
`collector_single_video_capture_timeout`；raw 任一窗口 75 秒无进展、或离线 worker 消失时，
只重启共享 UI 子进程并复用现有校准，launcher 随即恢复低优先级离线 worker。spool、pending、
已封批次和网页开关均不重置。随后只对该新故障调用一次 Agent。
只有新的持久故障证据才运行一次临时 Codex 修复任务，同一故障一小时内去重。自动任务先要求
工作树干净，再创建独立修复分支；验证失败时继续诊断、修改和重跑，直到目标测试、TypeScript、
构建和静态检查全部通过后才 commit、push 并创建 PR。真实阻塞时不推送；始终禁止自动合并、
部署、付费业务模型和真实微信 UI。

```bash
./scripts/install-weixin-channels-watchdog.zsh --check-source
./scripts/install-weixin-channels-watchdog.zsh --install
./scripts/install-weixin-channels-watchdog.zsh --check
```

本地日志：

- `/private/tmp/mvstudiopro-weixin-collector-watchdog.log`
- `/private/tmp/mvstudiopro-weixin-collector-agent.log`
- `/private/tmp/mvstudiopro-weixin-collector-agent-last.md`

重复执行 `--install` 时，如果安装内容未变化且 job 已加载，不重启正在运行的采集器；模板变化时才执行 bootout/bootstrap。

微信或系统重启后 CGWindow ID 变化不需要修改仓库；下一次网页开启采集时会重新按
“恰好两窗、同一 PID”规则绑定并显示两次十字星。若现场窗口数或 PID 不满足条件，
采集必须保持停止，先人工收敛窗口，禁止退回无约束自动选窗。
