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
| #996 | `fly.toml` 对齐线上真值：30 个 `[env]` 键被同名 secret 静默接管 | 绿 |
| #997 | `@` 改读资产库；不锁脸的成片被拦下 | 绿 |
| #998 | `@` 面板改挂 body；后期剪辑手法进出片提示词、不进审阅面 | 绿 |
| #999 | 关键道具出单件图（`propsheet-`），才真锁得住 | 绿 |

### 画布资产锁定这三刀（#997–#999）的共同根因

都是**接错了地方**，不是逻辑写错：

| 症状 | 接错在哪 |
|---|---|
| 敲 `@` 没反应 | 候选读的是「这段提示词自己的对照表」；资产一张没绑时它恒为空，偏偏那正是最需要挑图的时刻 |
| 面板有 30 条候选却看不见 | `absolute` 面板被审阅面 `overflow-y-auto` 容器裁掉；改 `createPortal` 挂 `body` + `fixed` |
| 道具没锁定 | `pickPropsForCharacterSheet` 把道具烧进**角色定妆卡的特写格**，道具没有自己的 URL：要么共用角色卡（摊薄锁脸权重），要么 `logical://` 被 `isBindableAssetPath` 滤掉 |

顺带补上的门禁：段里点了名的角色一个都没绑脸时**拦住出片**（`assetNoFaceLock`），
并把「还没出图」与「图对不上名字」分开报——混成一句话时没人知道该去补图还是改名。
这条也一并关掉了 07-25 交接里那个「资产解析不到路径时静默不绑」的待办。

### 出片提示词加了一层「怎么剪」（#998）

`shared/manhuaEditCraftDirectives.ts`：切点卡情绪不卡秒、同场景景别要有反差、
转场只在换场景用、音效补流畅度。两个设计点：

- **按段裁剪，不当常量墙灌**：单镜段不讲切镜（讲了反而诱导模型自己加一刀），
  无台词段不讲台词落点。
- **景别反差靠跨度判不靠字面**：「近景→中近景」字面不同但跨度只有 1，剪出来照样原地踏步，照抓。

只在出片那一刻拼进提示词，**不写回节点**——`【剪辑手法】` 进了
`FORBIDDEN_SECTION_PREFIXES`，审阅面那一栏人要读的是谁在做什么、说什么。

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

---

## 2026-07-28

本日未合 PR；开场按 `knowledge-base-always` 复核线上真值 + 补抽从没抽过的几个参考视频。

### 07-26 那三条观察项的结论

| 项 | 结论 |
|---|---|
| 三家平台连续 12h 没 merge | **已自愈**。5 个 `*.current.json.gz` 今日 09:56 全部刷新 |
| 探针是否真按 480p 计费 | **本来就对**。`SEEDANCE_PROBE_DEFAULT_QUALITY='480p'`，工厂探针 env 默认 `2.0-mini` / `480p` / 5s，与 `seedance-probe-always` 一致 |
| `performance-4x` 能不能降 `2x` | **条件已满足**：15 分钟负载 1.14（< 1.5），内存 3.3 / 9.9GB（< 5GB），4 vCPU。约省 $79/月 |

### douyin 热文件为什么还是 88.7MB（真因，与猜测不同）

两天过去仍是 93,035,343 字节。查文件头：

```
"updatedAt":"2026-07-28T09:55:11Z"          ← 外层壳每轮都在重写
"collection":{"collectedAt":"2026-07-26T08:25:15Z","windowDays":365,...}
```

**douyin 自 07-26 16:25(CST) 起没有一次成功采集**。裁剪只挂在 `mergeCollection` 上，
而外层壳的重写路径不经过裁剪 —— 于是采集失败的平台会**永久保留 365 天的旧载荷**，
`updatedAt` 每轮照跳，看着像在更新。

排除过的假设：`publishedAt` 缺失导致无法按日期裁 —— 实测空值只有 **147 / 609,896**（0.02%），
不是原因。单平台 61 万条也说明就算裁到 90 天，量级本身仍偏大。

**两条待办**（互相独立）：
1. douyin 采集连续失败 2 天，需查失败原因（trend 数据对产品也已过期）
2. 裁剪不该只在采集成功时才跑；采集失败的平台需要一次性回补裁剪，否则永远卡在旧窗口

### 参考视频抽帧补齐

`~/Downloads/2026Jul28/frames/`（脚本同目录 `extract-frames.sh`，已抽过的自动跳过）。
本轮补的是从没抽过的 6 个：`d1` `d2` `json` `tooth`（Jul16）、`man`（Jul18）、`jobs`（Jul20）、
`t1` `test1`（Jul21），共 1167 帧 + 88 个场景切点。
`c1/c2`（Jul22 已 6fps 超密 3648 帧）、`pr`/`trace`/`feel`/`sd25` 跳过。

无 OCR 工具（tesseract / pytesseract 都没有）。改用 **字幕条裁切拼长图**读内容：
`sheets/<tag>-NN.jpg`，一张图 16 句，比逐帧读省两个数量级。

### `json.mp4` 的可用结论（抖音「三步掌握 JSON 生图」）

跟「提示词很笨、没有电影感」这条抱怨直接对上：

1. **先定美学再写词**：挑一部喜欢的片 → 拆它的拍摄条件（画幅 21:9、色彩底色、
   相机预设如柯达胶片风 / 富士冷美感）→ 复刻。
2. **参数写成结构化块**，跨镜恒定，只换人物与环境：可见键有
   `aspect_ratio` / `camera_settings{camera,lens,film_stock}` / `style` /
   `lighting{type,quality}` / `attire` / `pose` / 渲染质量、「不允许数码锐化」。
   我们这边这一层是靠**垫图**承担的（brief §2「有垫图后禁止再写画风」），比写文字更硬。
3. **运镜要分解成时序**：「先做环绕再做推进，最后剪在一起」。
   **这条我们还没有** —— 现在每镜只出一个孤零零的运镜词（`近景微推`），
   `MANHUA_CAMERA_MOVE_ORDER` 里虽有「推拉结合」也只是个标签，不是两拍时序。

其余：`tooth.mp4` 是聊天记录体短剧（另一种内容形态，非漫剧管线）；
`d1.mp4` 是 CG 漫剧成片样片；`d2.mp4` 是起承转合 + 六栏分镜表教学（此前已部分入 craft）。

### 傍晚补抽消化（Jul18–21 四条样片）+ Jul25/26 账本

- `man`（Jul18）`jobs`（Jul20）`t1`/`test1`（Jul21）：同 IP（凌霄宗修仙）**漫剧成片样片**，
  三要素：右上竖排节拍标签（拦截/袭击/英雄救美，几秒一换）+ 底部短句对白 + 10s 内景别强反差。
  与 #998 剪辑手法方向互证，作节拍标签线参考样本。至此 Jul16–26 十二支 mp4 全部有密集帧。
- 补读 Jul25 `add-on.md`（#988 分镜秒段锁）、Jul26 `jobs-milstones-codes.md`（#994–999）。
- #999 已 MERGED（07-26 11:53Z），当前无 OPEN PR。

### ⚠ 纠正今早两条结论（douyin 真因，与猜测不同·其二）

今早「三家平台已自愈，5 个 current.json.gz 全部刷新」**看错了地方**——那是外壳
`updatedAt`/文件 mtime，每轮都跳；`collection.collectedAt` 才是真采集时间：

| 平台 | collectedAt | windowDays | 状态 |
|---|---|---|---|
| xiaohongshu | 07-28 新鲜 | **90** | ✅ 唯一逃脱（07-26 重启瞬间文件缺席，防缩保护 inert，一次性写入 90 天档） |
| douyin | 07-26 冻结 | 365 | ❌ 卡旧窗 |
| kuaishou / bilibili / toutiao | 07-25 冻结 | 365 | ❌ 卡旧窗 |

**真因**：`writeStore` 的「防缩保护」（`allowLowerTotals` 默认 false，`nextCount < existingCount`
就把**旧集合整体换回**）vs #995 热窗裁剪对撞。调度器状态里每家 `failureCount=0`、
`lastSuccessAt` 新鲜——**采集一直是成功的**，merged 池被 prune 裁小后在落盘前一刻被换回旧档。
07-26 16:25 正是 `GROWTH_TARGET_WINDOW_DAYS` secret 改成 90 的时刻：之前 prune(365) 不裁、
保护不触发；之后 prune(90) 裁小、保护每天把裁剪结果换回去。douyin 每轮还在 parse+重写
93MB 旧载荷，#995 想省的 GC 一点没省到。

**修法**（本分支 `fix/growth-merge-prune-lower-totals`）：merge 语义下池子只会因裁剪变小
（dedupe 只增不减），故 `mergeTrendCollectionsWithOptions` 显式
`writeStore(next, { allowLowerTotals: true })`；mergeStats 加 `prunedFromCount` 可观测。
防缩保护对其他 writeStore 调用方（恢复/直写）保留默认。顺带修 `trendAdaptiveConfig`
固定 `.next` 临时名并发写 ENOENT 竞态（vitest 并行 worker 实踩）。

**上线后预期**：下一轮 merge（≤15 分钟）四家平台 collectedAt 跟进、windowDays→90，
douyin 文件应从 93MB 量级显著下降。原「失败平台一次性回补裁剪」待办消解——没有失败平台，
全是假成功。

### 晚间收工（#1000–#1005）

| PR | 内容 | Deploy / 备注 |
|---|---|---|
| #1000 | growth merge 放行热窗裁剪 | 绿；21:32 SSH：五家均为 window=90，douyin ≈50MB |
| #1001 | 运镜两拍时序 | 绿 |
| #1002 | 成片 `@` 面板 + 提及连边 | 绿 |
| #1003 | 成片另起横带 + seedLibraryId 认亲 + 独白补名 | 合入后 Deploy **红**（tsc） |
| #1004 | `mediaUrlOf` Partial 热修 | 绿 |
| #1005 | `fly.toml` 对齐 performance-2x / 8GB | **OPEN**（Deploy 曾把 2x 顶回 4x；现场已再 scale 回 2x） |

交接全文：`~/Downloads/2026Jul28/jobs-and-codes.md`。

---

## 2026-07-29

漫剧第 1 集「能出图 → 能锁脸 → 成片别错绑」四刀合入；Fly Deploy 均 **success**。

| PR | 内容 | Deploy |
|---|---|---|
| #1032 | 设定图认领进 `@`（含道具） | 绿 |
| #1033 | 素材库上限 16→48 | 绿 |
| #1034 | 静帧不再硬塞内置示范道具（红团扇） | 绿 |
| #1035 | 场景名对齐 `@场景`；秒轴禁模板废话；道具按可拍表/对白 | 绿 15:23Z |

线上：认领后 refs≈21；第1集 13 张静帧有图但 #1034 前污染 → 须重出；成片须硬刷新重铺。

交接：`~/Downloads/2026Jul29/jobs-and-undo.md`；夜段：`~/Downloads/2026Jul30/jobs-and-reports.md`。

小说谱系：`wusha-v6.md` → 三季/三卷 → **优化定稿**（Jul30）。

---

## 2026-07-30

- 用户明文：**明日主线 = 画布 + 锁定优化**（见 `jobs-and-reports.md` §6.1）。
- 剧情：`雁门照山河_*优化定稿.md`（公审对齐短剧第二季末；短剧补人物卡/东墙埋线/第29集剥橘）。
- Downloads 扫描：Jul01–30 共 md≈104、mp4≈80；缺 Jul27；Jul22 起无新 mp4。

---

## 2026-07-31

画布 + 锁定收口（本分支 → 待开 PR）：

1. **锁**：`findManhuaSegmentAssetBindGap` 接入；可拍表全员脸锁；脸 seed 剥 `face-`；反推重铺尊重 `sceneZh`；连边禁漂号 `@场景N`；认领报数按库剩余容量；资产边计数可核验。
2. **画布 UX**（对照用户上传竞品截图 IA，不抄模型名）：左栏「画布/资产」Tab + 搜索 +「共 N 节点」点选定位；底栏视野%；成片节点「比例·时长·资产边」摘要；资产→成片连线加亮。
3. 知识库：本文件补 07-29…31；`downloads-jul2026-index` 扩到 Jul30。

本地：`pnpm check` ✅；相关 vitest 105 ✅。

---

## 如何更新本文件

合完 PR 或用户改口径后，在**当日**下追加表格行；下一自然日新开 `## YYYY-MM-DD`。  
大方向变更同步改 `manhua-factory-brief.md` §2–3。
