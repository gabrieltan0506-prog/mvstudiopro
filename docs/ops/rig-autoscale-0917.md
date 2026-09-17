# rig 进程组按需启停（PR-B）· 运维说明

## 为什么
Blender（绑骨/白模）必须与 app 分机跑——同一台 8 GB 机上 Node 堆 + Blender 2.3 GB 会 OOM（0917 主机被打挂一次，事故簿有记）。
但 rig 机是 performance 4 核 8 GB，24 小时常驻在没有进账的阶段是纯成本。本改动让它只在有活时开着。

## 行为
- **app 机**：每 15 秒看一次队列里有没有 `manhua_auto_rig` / `manhua_previs` 的 **`queued`** 任务（`running` 的那单已经有机器在跑，再数它会把别的 rig 机也拉起来空转）；有且 rig 机是 stopped，就用 Fly Machines API 启动它（60 秒冷却，不重复发命令）。
  仅在 `MANHUA_RIG_WORKER_SPLIT=1`（fly.toml 里 app 进程组已带）时唤醒——没分流时 app 自己领 Blender 任务，再唤醒 rig 就是两台抢同一单。
- **rig 机**：每 15 秒判一次；本进程没任务在跑、队列里也没有 Blender 任务（这里数 `queued+running`）、且这个状态连续满 10 分钟，就停掉**自己这台**。
  停机前先关本进程的领单闸，关闸后**再核一次**本进程是否刚领到单（两次查询各跨一次网络往返，1 秒一轮的 post_prod 通道可能在这期间领到单）；核出在跑就撤回停机。
  停机命令发出后本进程若仍活着超过 5 分钟（SIGINT 处理器最迟 10 秒强制退出，所以只能是机器没真停或被立刻重启），自动复位领单闸，不留一台活着却不领单的空转机。
- 只碰 `fly_process_group === "rig"` 的机器，app 机永不参与启停。

## 前置：一条 Fly secret（只能由用户在 Fly 侧设置）
```
fly secrets set FLY_API_TOKEN=<fly deploy token> -a mvstudiopro
```
- token 建议用 app 级 deploy token（`fly tokens create deploy -a mvstudiopro`），权限够启停本 app 的机器即可。
- **不要**把它写进本机 .env、shell、日志或任何交接档（知识库《生产密钥只留 Fly · 硬红线》）。
- `FLY_APP_NAME` / `FLY_MACHINE_ID` 由 Fly 运行时自动注入，不用配。
- 设 secret 会重启机器 —— 有绑定/白模在跑时不要设。

## 两个必须知道的运维边界
1. **`fly scale count rig=0` 之后本机制救不了**：唤醒只会 `start` 已存在的 rig 机，不会新建机器。rig 数量为 0 时 Blender 任务会一直排队，约 20 分钟后被 `staleJobsReaper` 改判 `failed`（"后期任务已停止,请重新提交"）。要省钱请让 rig 机存在但 **stopped**，不要 scale 到 0。
2. **排队超时窗口**：`staleJobsReaper` 对 `post_prod` 的 `queued` 行按 `createdAt` 计时，默认 20 分钟（`JOBS_STALE_QUEUED_HOURS` / `JOBS_STALE_MINUTES` 未设时）。唤醒最坏路径 = 15 秒轮询 + Fly 冷启动，远在窗口内；但**没配 `FLY_API_TOKEN` 又把 rig 停着**时，任务就是在这 20 分钟后静默判失败——启动日志里那行 `[rig-autoscale] …没有 FLY_API_TOKEN…` 就是给这种情况留的。

## 没配 secret 会怎样
整条链静默 no-op，行为与本 PR 之前完全一致：rig 机维持当前状态，任务照排队照跑。**先合并部署、再设 secret** 是安全的。

## 开关与阈值
| 变量 | 默认 | 说明 |
|---|---|---|
| `MANHUA_RIG_AUTOSCALE` | `1` | 设 `0` 关掉整个自动启停（rig 保持常驻），不用回滚代码 |
| `MANHUA_RIG_IDLE_STOP_MS` | `600000`（10 分钟） | 空闲多久停机；下限 60 秒；设 `0` 只唤醒不停机 |

## 验收（线上）
1. 设好 secret 后，`fly machine stop <rig id>` 或 `fly scale count rig=0`→`rig=1` 后手动停掉 rig 机。
2. 页面提交一次白模（免费）→ 15 秒内 app 日志出现 `[rig-autoscale] 有 N 个 Blender 任务在队，已启动 rig 机 …`，`fly status` 里 rig 转 started，任务被领走。
3. 任务完成后静置 10 分钟 → rig 日志出现 `rig 空闲 … 停机`，`fly status` 里 rig 变 stopped。
4. 期间 app 机状态不变（反例对照：app 机一次都不该出现在启停日志里）。

## 不做
- 不改 `fly.toml`：rig 进程组的声明、规格、部署都照旧，这里只管它平时开着还是停着。
- 起不来 / 停不掉只记日志，绝不改任务状态——任务排队等着，比误判失败安全。

## 合并前探针（不碰生产）
```
npx tsx server/scripts/probe_rig_autoscale.ts
```
起一台假 Fly Machines API，让真代码（`resolveRigAutoscaleDeps → listRigMachines → start/stop`）跑真 HTTP 往返，15 条断言：
方法/URL/Bearer 头、只启 rig 不碰 app、已 started 不重发、队列有任务不停机、空闲才停、停机前先关领单闸、
**关闸后发现刚领到单就撤回停机（一个 stop 都不发）**、停机命令真被 502 拒绝时只报不抛且复位、
没 token 一个请求都不发、**本机不在 rig 进程组时拒绝停机**。
最后一条是反例对照：把进程组保险去掉，探针立刻红并显示它会去停 `app-1`（站点下线）。

它**不能**证明真实 Fly API 接受这些请求——那需要生产 token，只在 Fly env，不下本机。
真实验收仍按上一节四步，在 secret 设好之后做。
