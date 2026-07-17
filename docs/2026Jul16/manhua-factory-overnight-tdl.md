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

## 本回合已合：[#773](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/773) `feat/manhua-genre-auto-infer`

**目标**：题材一句可自动推断剧种并套场景包；手动剧种仍优先；`/canvas` 工厂栏位层次可读。

### TDL

- [x] 写清过夜计划（本文）
- [x] `inferManhuaGenreFromTopic` / `resolveManhuaGenreId`
- [x] spawn 未选手动剧种时自动套用
- [x] `pnpm run manhua:genre-probe` ×2 PASS
- [x] `/canvas` 栏位重排（题材为主；Soon 改脚注）
- [x] `tsc` + vitest PASS → PR #773 → 自行 MERGED
- [ ] （可选）`manhua:probe` 线上五段——曾故事 PASS、角色卡 **503**（线路/配额，非 #773 逻辑）

### 睡醒后你怎么验

1. 看 [#773](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/773) 与本文。  
2. `/canvas`：只填「仙门外门弟子闯秘境」→ 铺节点 → 应自动套仙侠。  
3. 手动选「都市」应覆盖推断。  
4. `pnpm run manhua:genre-probe` 应全 PASS。

## 下一刀候选（续作进度）

1. [x] 题材关键词 → 推荐单一场景（如「秘境」→ scene_04）→ 分支 `feat/scene-keyword-recommend`  
2. [x] 工厂角色卡 503 退避/换模型 → 分支 `feat/bible-503-model-fallback`  
3. [x] Seedance 成片探针（贵，默认关）→ `pnpm run manhua:seedance-probe`；真打需 `CANVAS_PROBE_SEEDANCE=1`  
