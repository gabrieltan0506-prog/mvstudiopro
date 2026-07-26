# 开发进度（滚动）

格式：日期 → 已合/在飞 → 下一步。Agent 改完一块应**追加**当日条目，勿改写历史。

---

## 2026-07-24

### 已合入 main

| PR | 内容 | Deploy |
|---|---|---|
| #963 | 成片秒轴短指令 + Image 硬绑 + 预算 5–6 段 + Terra 优先 | 曾红 → 由 #964 热修 |
| #964 | tsc 热修 + 画布：提示词主区 / 上传窄栏 / 静帧只图+ID | 绿 |
| #965 | 成片去掉「画风：…」，跟垫图走 | 绿 |
| #966 | 本段资产瘦身 + 成片节点中区改垫图 | 绿 |
| #967 | 真锁可拍表角色；秒轴动作/运镜轨迹+场景光影锁；光学误灌修复 | 红（tsc） |
| #968 | 修 #967 tsc：去 `/u`、`matchAll`→`Array.from` | 绿（合并后） |

### 进行中 / 未合

| 项 | 状态 |
|---|---|
| #969 | OPEN：协作 rules + 知识库 + **Downloads 七月索引**（`fix/pr967-deploy-hotfix`） |
| 线上旧草稿成片提示词 | 合入代码后需用户再点「审阅成片提示词」重铺才干净 |

### 知识库增量（同日）

- 已消化 `~/Downloads/2026Jul01`–`24` 全部交接 md（约 78）：分类见 `downloads-jul2026-index.md`  
- alwaysApply：`knowledge-base-always.mdc` 强制开场读 brief / PROGRESS / 七月索引

### 进行中（本分支 `fix/manhua-ui-friendly-triad`）

| 项 | 内容 |
|---|---|
| UI 友好 | 画布/工作台去「Image对照 / Seedance / Gemini / id=」等技术词；成片芯片显示人名 |
| 可拍表 | 工作台可填「本段出场」真名；缺角色行时从对白「姓名：」推断 |
| 成片 | 审阅路径用推断真名锁脸；旧草稿仍需再点「审阅成片提示词」 |

### 已知缺口（下一刀候选）

1. **对白仅光秃「」句、无姓名前缀**：说话人仍弱 → 需表演行/意图补名或强制对白带说话人  
2. **Skill / 旧 docs** 与预算期 5–6 段口径未全量对齐  
3. 描述词（黑衣剑客）↔ 真名：已引导 UI 写真名 + 对白推断；纯描述词无 lookZh 时仍可能空锁

### 老板当日原话级验收点（摘要）

- 不要画风废话；不要整集人灌进 15s  
- 中间只要图（角色/场景/道具/垫图），不要 ID 墙占主区  
- 动作轨迹、运镜轨迹、灯光、景别、氛围、场景锁都要有  
- 推送要看得见（分支/PR 说清楚）；用户明文优先于门禁  

---

## 2026-07-26

### 已合入 main

| PR | 内容 | Deploy |
|---|---|---|
| #994 | growth 冷备 cron 每小时 → 每 2 小时 | 绿 |
| #995 | 热数据保留窗口 365 → 90 天（`pruneTrendItemsToHotWindow`） | 绿 |

> 07-25 那批（#974–#993，画布工作台改版 / 分档 60-90s·150-180s / 局部改写归档 / 假 401 修复）
> 明细见 `~/Downloads/2026Jul25/jobs-and-code-byOpus5.md`。

### 踩坑：fly.toml 的 `[env]` 会被同名 secret 静默盖掉

**#995 合了但没生效**——`GROWTH_TARGET_WINDOW_DAYS` 存在同名 Fly secret（值 365），
优先级高于 `[env]`，裁剪逻辑空转十小时，douyin 热文件 88.3 → 88.7MB 不降反升。
排查发现共 **30 个键**被 secret 接管，其中 23 个值与 `fly.toml` 不同，方向还是混的
（页数被调高、并发与超时被调低）。

**处置**：`fly secrets set GROWTH_TARGET_WINDOW_DAYS=90 DOUYIN_TREND_PAGES=24`，
并把 `fly.toml` 全部对齐线上实际值 + 逐行标注「secret 接管」。

**给后来人**：改 `fly.toml` 的 `[env]` 前先 `fly secrets list` 查同名键；
验证一律用 `fly ssh console -C 'printenv KEY'` 看运行时真值，不要看 machine config。

### 采集强度现状

`DOUYIN_TREND_PAGES` 40 → 24（每页 12 条，约 480 → 288 条/轮，15 分钟一轮）。
`GROWTH_FORCE_BURST_*` 是死配置：`UNTIL` 停在 2026-03-27，
`isForceBurstActive` 的 `> Date.now()` 让它早已失效，可清理。
`KUAISHOU_PRIVATE_PAGES` secret 写 30，但代码 `Math.min(6,…)` 夹住，实际 6。

### 下一步

- 观察几轮 merge 后 douyin 热文件是否随 90 天窗口回落
- 15 分钟负载稳定 < 1.5、内存 < 5GB 时，可把 `performance-4x` 降到 `2x`（约省 $79/月）

---

## 如何更新本文件

合完 PR 或用户改口径后，在**当日**下追加表格行；下一自然日新开 `## YYYY-MM-DD`。  
大方向变更同步改 `manhua-factory-brief.md` §2–3。
