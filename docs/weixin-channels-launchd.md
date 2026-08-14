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
- 采集令牌只在进程启动时从登录用户 Keychain 的 `mvstudiopro-weixin-channels-collector` 服务读取，不写入仓库、plist、日志或锁文件。
- plist 的 `KeepAlive.SuccessfulExit=false`：采集器非零退出时自动重启；网页停采、安全熔断等正常退出不会重启。
- 安装脚本会加载并立即启动 job。合并前、采集开关关闭时或双窗未验收时，只运行源码校验，不得执行安装。

## 合并前只读校验

```bash
./scripts/install-weixin-channels-launchd.zsh --check-source
```

该命令检查 shell 语法、plist、受限双窗自动绑定、正式十字星校准、网页开关监督、
禁止硬编码 windowId、Keychain 读取入口及 KeepAlive 契约；不读取令牌，也不修改 launchd。

## 合并后安装

先确认屏幕上只有两个待采集的视频号独立窗口，且它们属于同一微信进程，再执行：

```bash
./scripts/install-weixin-channels-launchd.zsh --install
./scripts/install-weixin-channels-launchd.zsh --check
```

重复执行 `--install` 时，如果安装内容未变化且 job 已加载，不重启正在运行的采集器；模板变化时才执行 bootout/bootstrap。

微信或系统重启后 CGWindow ID 变化不需要修改仓库；下一次网页开启采集时会重新按
“恰好两窗、同一 PID”规则绑定并显示两次十字星。若现场窗口数或 PID 不满足条件，
采集必须保持停止，先人工收敛窗口，禁止退回无约束自动选窗。
