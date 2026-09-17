# rig 进程组按需启停（PR-B）· 运维说明

## 为什么
Blender（绑骨/白模）必须与 app 分机跑——同一台 8 GB 机上 Node 堆 + Blender 2.3 GB 会 OOM（0917 主机被打挂一次，事故簿有记）。
但 rig 机是 performance 4 核 8 GB，24 小时常驻在没有进账的阶段是纯成本。本改动让它只在有活时开着。

## 行为
- **app 机**：每 15 秒看一次队列里有没有 `manhua_auto_rig` / `manhua_previs` 的 `queued|running` 任务；有且 rig 机是 stopped，就用 Fly Machines API 启动它（60 秒冷却，不重复发命令）。
- **rig 机**：每 15 秒判一次；本进程没任务在跑、队列里也没有 Blender 任务、且这个状态连续满 10 分钟，就停掉**自己这台**。
- 只碰 `fly_process_group === "rig"` 的机器，app 机永不参与启停。

## 前置：一条 Fly secret（只能由用户在 Fly 侧设置）
```
fly secrets set FLY_API_TOKEN=<fly deploy token> -a mvstudiopro
```
- token 建议用 app 级 deploy token（`fly tokens create deploy -a mvstudiopro`），权限够启停本 app 的机器即可。
- **不要**把它写进本机 .env、shell、日志或任何交接档（知识库《生产密钥只留 Fly · 硬红线》）。
- `FLY_APP_NAME` / `FLY_MACHINE_ID` 由 Fly 运行时自动注入，不用配。
- 设 secret 会重启机器 —— 有绑定/白模在跑时不要设。

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
起一台假 Fly Machines API，让真代码（`resolveRigAutoscaleDeps → listRigMachines → start/stop`）跑真 HTTP 往返，13 条断言：
方法/URL/Bearer 头、只启 rig 不碰 app、已 started 不重发、队列有任务不停机、空闲才停、停机前先关领单闸、
Fly 502 只报不抛且复位、没 token 一个请求都不发、**本机不在 rig 进程组时拒绝停机**。
最后一条是反例对照：把进程组保险去掉，探针立刻红并显示它会去停 `app-1`（站点下线）。

它**不能**证明真实 Fly API 接受这些请求——那需要生产 token，只在 Fly env，不下本机。
真实验收仍按上一节四步，在 secret 设好之后做。
