# env-tooling · 本机作业环境与工具事实

## 共享 worktree 险境
- 主仓 `~/.codex/worktrees/974b/mvstudiopro` 多 agent 共用：**永不 `git checkout` 切分支、永不裸 `git stash pop`**（stash 栈曾深达 64 层，pop 出别人的 WIP 冲突）。
- 标准作业法：`git worktree add <临时目录> -b <新分支> origin/main`（或检出既有分支）→ 干活 → `git push origin HEAD:<分支>` → `git worktree remove`。分支被占用时先 `git worktree list` 找现成的。
- 幽灵 worktree（状态自相矛盾）不修，弃用换新目录。

## 子代理与算力
- 子代理**一律串行**（双核机，并行即卡死）；tsc/vitest 等重活不并行；本地重 ffmpeg 前台单跑。
- 默认 medium reasoning，最难任务才临时拉高（烧光额度实锤）。

## 浏览器
- 内置浏览器（右侧面板）带登录态，读页/截图/trpc 全通；**面板隐藏时页面 JS/rAF 冻结**，`preview_start`/`tabs_select` 可自唤醒。
- Chrome 扩展注入超时 = Chrome 久跑老化，让用户重启 Chrome 一次全解；agent 只能操作自己 tabs 组。
- 页面截图落文件管线：CDN 注入 html2canvas-pro（支持 oklch）→ canvas.toDataURL → 超长结果自动落文件 → jq/sed + `base64 -d` → JPG。

## ffmpeg 备忘（本机 build）
- 无 drawtext；移动水印用 overlay `x='abs(mod(t*K,2*(W-w))-(W-w))'`；对比帧 hstack。
- 大文件下载断流用 `curl -C -` 续传；消费生成媒体前先探 duration 对表（截断文件实锤）。

## 其他
- pdf-worker 链（customCopyPdfExport→downloadPlatformPdf→pdf-worker）非必要不动——改一次用户要重置一次终端。
- 交接文档写 `~/Downloads/2026MonDD/`；UI 改版必须考虑老存档迁移（旧坐标躺着=用户看到「根本没变」）。
- frontend-design skill 在 `~/.claude/skills/frontend-design/`（hero 即论点、结构即信息、用户词汇、反 AI 味）。UI 入口先过四问：零位移/一步达/可批量/可撤销。
