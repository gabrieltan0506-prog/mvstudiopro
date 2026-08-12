# deploy-verify · 部署与验收事实

## 部署形态
- Vercel 只放前端（12 serverless 函数上限，新后端一律进 Fly）；`/api/*` rewrite 到 Fly `mvstudiopro.fly.dev`。
- Fly：**单机双核** performance-2x，/data 独占卷。禁 `fly scale count 2`（卷分裂）；禁密集 `fly ssh console`（压垮健康检查）。`fly.toml [env]` 会被同名 secret 静默接管。
- DB = Neon Postgres（拍板保留，勿再提迁移）。合并门禁只认 Fly Deploy success。

## 合并前三道闸（顺序执行，不许写进一条 && 链）
1. `gh run list --branch main` 无 in_progress Fly Deploy（条件闸样板见 work-rules 18.5）。
2. `fly logs` 瞄一眼有无扩写/学习类长任务在途——**单机换版会杀死在途任务且无退款路径**。
3. 画布有运行中生成批次 → 我自己发起的合并一律等；**用户批准的部署永远放行**（越权取消=P0-4）。

## 验证口径
- `pnpm check > file 2>&1; echo $?` —— 管道会吞退出码（`| tail` 假绿实锤 #1173）；grep 无命中会毒 pipefail。
- 没跑验证只能说「已实现，未验证」；本地绿不冒充线上验收；疑点未闭环禁止肯定陈述（work-rules 3/23）。
- 线上验收双通道：内置浏览器（带登录态，截图/读页/trpc 全可用）优先；Chrome 扩展注入超时 = 让用户重启 Chrome，不构成不验证的理由。
- **Vercel WAF 拦 agent 会话的写请求（读全通）**：烧钱/删除类点击交用户手点，agent 盯 `fly logs` 对账。curl 一律 403，状态检查无效——验证只认真实浏览器。**永不建议调低防火墙**（P0-3）。

## Fly one-shot 脚本模式
脚本 → base64 → `fly ssh console -C "sh -c 'echo $B64 | base64 -d > /tmp/x.mts && cd /app && npx tsx /tmp/x.mts'"`。base64 仅作脚本传输（见 channels.md 铁律），用即说明。
