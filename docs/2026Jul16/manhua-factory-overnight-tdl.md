# 漫剧工厂 · 过夜 TDL / 进度（2026-07-17）

> 你醒过来先看这份。约定：**你睡着期间准许自行 merge；你接管后禁止自行 merge。**

## 已完成（main 上）

| 项 | PR | 状态 |
|----|-----|------|
| 编导分镜图 + 导演灵感画布 | #769 | MERGED |
| 自动漫剧工厂（链式跑 / 场景资产库 01–20 / 七剧种） | #770 | MERGED |
| Seedance 2.5 骨架 + Coming soon | #771 | MERGED |
| GPT-5.6 官方优先 + Skill 分组 | #768 | MERGED |
| `setRotatingCardIndex` Fly tsc | #772 | MERGED |

## 本回合进行中：`feat/manhua-genre-auto-infer`

**目标**：题材一句可自动推断剧种并套场景包；手动剧种仍优先；`/canvas` 工厂栏位层次可读。

### TDL

- [x] 写清过夜计划（本文）
- [x] `inferManhuaGenreFromTopic` / `resolveManhuaGenreId`（`shared/screenwriterGenreTemplates.ts`）
- [x] `spawnManhuaDramaStudio` 未选手动剧种时自动套用
- [x] 探针 `pnpm run manhua:genre-probe`（本地无网）
- [x] **探针 ×2**：genre-probe 两轮均 OK
- [x] `/canvas` 工厂入口栏位重排（题材为主、剧种/场景为辅；Soon 压成一行脚注）
- [ ] 本地 `tsc` + 相关 vitest + genre-probe×2（ship 前）
- [ ] （可选）`manhua:probe` 线上五段——上次故事 PASS、角色卡 **503**（线路/配额）
- [ ] push → 开 PR →（睡着期间）自行 merge

### 栏位 / 审美原则（本回合约束）

1. **一个主入口**：题材一句占满宽，视觉权重最大。  
2. **剧种 / 场景是辅**：同一行次要控件，不与题材抢第一眼。  
3. **Soon 条不压主流程**：Seedance 2.5 提示保留，但不插在题材与操作按钮之间造成断层。  
4. **阶段芯片 + 动作钮**：芯片示意进度，按钮一组操作，不散成两坨无结构色块。  
5. 文案短：自动推断用一行 helper，不堆说明。

### 睡醒后你怎么验

1. 打开 PR（标题含 `题材自动推断剧种`）看 Summary。  
2. `/canvas`：只填「仙门外门弟子闯秘境」→ 铺节点 → 应自动套仙侠场景包。  
3. 手动选「都市」应覆盖推断。  
4. `pnpm run manhua:genre-probe` 应全 PASS。

## 下一刀候选（未开干）

1. 题材关键词 → 推荐单一场景（如「秘境」→ scene_04），仍可手改。  
2. 工厂失败时角色卡 503 的退避/换模型（属平台 API，另开）。  
3. 全自动成片探针（Seedance，贵，默认关）。  
