# 视频号双窗口 launchd 安装与校验

## 运行边界

- 正式采集只由一个 launchd job 启动；launcher 另用原子目录锁防止重复进程。
- 正式命令固定绑定左窗 `56885` 和右窗 `56915`。缺窗、换窗或窗口 ID 失效时必须失败关闭，禁止自动选窗。
- 采集令牌只在进程启动时从登录用户 Keychain 的 `mvstudiopro-weixin-channels-collector` 服务读取，不写入仓库、plist、日志或锁文件。
- plist 的 `KeepAlive.SuccessfulExit=false`：采集器非零退出时自动重启；网页停采、安全熔断等正常退出不会重启。
- 安装脚本会加载并立即启动 job。合并前、采集开关关闭时或双窗未验收时，只运行源码校验，不得执行安装。

## 合并前只读校验

```bash
./scripts/install-weixin-channels-launchd.zsh --check-source
```

该命令检查 shell 语法、plist、两个唯一 windowId、Keychain 读取入口及 KeepAlive 契约，不读取令牌，也不修改 launchd。

## 合并后安装

先确认两个视频号独立窗口仍分别是 `56885`、`56915`，且 Fly 网页采集开关允许启动，再执行：

```bash
./scripts/install-weixin-channels-launchd.zsh --install
./scripts/install-weixin-channels-launchd.zsh --check
```

重复执行 `--install` 时，如果安装内容未变化且 job 已加载，不重启正在运行的采集器；模板变化时才执行 bootout/bootstrap。

若微信重启后 CGWindow ID 变化，先保持采集停止，重新完成双窗绑定与探针验收，再更新 launcher 中的两个 ID。不得临时删除 windowId 参数恢复自动选窗。
