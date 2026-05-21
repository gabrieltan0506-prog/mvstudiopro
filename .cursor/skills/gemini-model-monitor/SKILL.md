---
name: gemini-model-monitor
description: >-
  当用户说「启动监测」「啟動監測」「启动监控」「模型探针」时，执行 Gemini API
  模型白名单探针（omni/veo 关键字），并回报是否解封。使用 pnpm run gemini:monitor。
---

# Gemini 模型白名单监测

## 触发语（任一即执行）

- 启动监测 / 啟動監測 / 启动监控
- 模型探针 / 检查 omni / 检查 veo 是否开放

## 你必须做的事

1. **不要**只描述步骤——立刻用 Shell 在项目根目录执行：

```bash
pnpm run gemini:monitor
```

2. 若当前不在 `mvstudiopro` 仓库，先 `cd` 到该仓库（常见路径：`~/Projects/mvstudiopro`、`.codex/worktrees/*/mvstudiopro`），再执行上述命令。

3. 将终端完整输出摘要给用户：
   - 若出现 `🚨🚨🚨 [重大发现]`：列出解封的 model id，提醒可测 TestLab Gemini Omni。
   - 若出现 `💤 监控报告`：说明 omni/veo 尚未开放，并列出前 5 个可用模型。
   - 日志含 `🔑 [凭据] Fly · mvstudiopro` 表示已用生产 secret。
   - 若失败：确认本机已安装 `fly` CLI 且已 `fly auth login`；或设 `GEMINI_MONITOR_SKIP_FLY=1` 仅用本地 key。

4. 退出码：`0` 正常无警报；`2` 发现 omni/veo；`1` 配置或连线失败。

## 可选环境变量

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | Fly 不可用时回退；支持 `AIza` / `AQ.` |
| `GEMINI_MONITOR_FLY_APP` | Fly app，默认 `mvstudiopro` |
| `GEMINI_MONITOR_SKIP_FLY` | `1` = 不读 Fly，仅用本地 |
| `GEMINI_MONITOR_PREFER_LOCAL` | `1` = 同 SKIP_FLY |
| `GEMINI_MONITOR_KEYWORDS` | 默认 `omni,veo` |
| `GEMINI_MONITOR_WEBHOOK_URL` | 发现新模型时 POST JSON 通知 |

## 实现位置

- 脚本：`scripts/gemini-monitor.ts`
- 逻辑：`server/services/geminiModelMonitor.ts`
