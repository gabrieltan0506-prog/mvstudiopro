# grokjobs-and-codes · 2026-07-10

> 分支：`feat/platform-blueocean-storyboard-shooting`  
> 范围：`/platform` 全案推演文案接入蓝海词/标签；分镜生成接入上传图拍摄手法

---

## 背景（扫描结论）

扫描 `Downloads/2026Jun26–29`、`2026Jul03–09` 与仓库 `docs/2026Jul*`、GitHub 蓝海词相关实现后确认：

| 能力 | 此前状态 | 本 PR |
|------|----------|--------|
| Stage1 `platformMenu.blueOceanWords` | 有，但 Stage2 prompt 未强制使用 | 注入 `blueOceanLexicon` + 使用策略 |
| 趋势报表 `globalBlueOceanWords` | 仅 Visual Report UI | 入队 Stage2 job |
| trendStore tags | 仅在高互动样本里 | 每平台 `tagCandidates` 作二级词种子 |
| 决策智库单条扩写 | 无蓝海块 | 可选 `blueOceanLexicon` |
| 上传图 `shootingBlueprint` | 分析有、分镜未接 | `formatShootingTechniqueBrief` → scriptContext |
| `executionDetails` → 2×4 | 中文直送路径忽略 | 与拍摄手法一并注入 |

参考资料：`2026Jul05/blueoceans.md`（一级/二级蓝海词定义）；用户上传的线下课手机剪辑教学解析图（固定中远景、前景操作物、背景大屏）→ `TEACHING_DEMO_COMPOSITION_HINTS`。

---

## 代码变更摘要

### 1. 蓝海词词表（shared）

**文件**：`shared/blueOceanLexicon.ts`

- `buildBlueOceanLexicon`：合并 platformMenu / globalBlueOceanWords / tagCandidates
- `deriveTagCandidatesFromTrendSamples`：从 trendStore 样本 tags/标题碎片抽种子
- `BLUE_OCEAN_USAGE_POLICY`：Stage2 强制自然嵌入 1–3 词 + `highlightKeywords`

### 2. Stage2 全案推演文案

**文件**：`server/routers.ts` → `buildPlatformContent`

- user JSON 增加 `blueOceanLexicon`、`blueOceanUsagePolicy`
- system 增加【蓝海词与标签推演】；schema 增加 `highlightKeywords`
- `normalizePlatformContentKeys` 保留 `highlightKeywords`
- `enqueuePlatformContentJob` 接收 `globalBlueOceanWords`
- worker：`server/jobs/runner.ts` 传入 `globalBlueOceanWords`

**文件**：`server/services/stage1StrategicHandoff.ts`  
`platformMenuDigest` 增加 `blueOceanWords` 摘要。

**文件**：`server/services/decisionIntelBonusBlueprints.ts`  
选题扩写 prompt 可注入蓝海词块。

**客户端**：`PlatformPage.tsx`

- Stage2 入队带上 `visualReportData.globalBlueOceanWords`
- 决策智库 / 自定义选题 mutation 传 `decisionIntelBlueOceanLexicon`
- 执行卡展示「蓝海 / 高亮」chips

### 3. 拍摄手法 → 分镜

**文件**：`shared/shootingTechniqueBrief.ts`

- `formatShootingTechniqueBrief`：构图/光影分、`shootingBlueprint`、教学演示构图参考
- `TEACHING_DEMO_COMPOSITION_HINTS`：固定中远景 + 前景操作 + 背景大屏

**链路**：

1. `platformAssetAnalysisHandoff` 产出 `shootingTechniqueBrief`
2. `PlatformAssetAnalysisPanel` → `onShootingTechniqueReady`
3. `buildPlatformSheetScriptContext` 追加【上传素材拍摄技法】
4. `generatePlatformCompositeSheetImage` 合并 `executionDetails` + `shootingTechniqueBrief` →【光影与机位约束】
5. `buildCompositeSheetDirectChineseBody` 要求八格景别/运镜对齐该约束

---

## 关键代码片段

```ts
// shared/blueOceanLexicon.ts — Stage2 词表
export function buildBlueOceanLexicon(input: {
  platformMenu?: unknown;
  globalBlueOceanWords?: unknown;
  tagCandidates?: string[];
}): BlueOceanLexicon { /* flat + grouped + tagCandidates */ }
```

```ts
// buildPlatformContent — 推演文案注入
const blueOceanLexicon = buildBlueOceanLexicon({
  platformMenu: params.platformMenu,
  globalBlueOceanWords: params.globalBlueOceanWords,
  tagCandidates: allTagCandidates,
});
// → stage2UserJsonString.blueOceanLexicon + BLUE_OCEAN_USAGE_POLICY
```

```ts
// proxyImageService — 分镜注入拍摄手法
const stagingBits = [
  String(options.executionDetails || "").trim(),
  String(options.shootingTechniqueBrief || "").trim(),
].filter(Boolean);
if (stagingBits.length) {
  scriptContextForPipeline += `\n\n【光影与机位约束·拍摄手法】\n${stagingBits.join("\n\n")}`;
}
```

---

## 测试

```bash
pnpm exec vitest run server/services/buildBlueOceanLexicon.test.ts
```

（3 tests passed）

## 建议手测

1. `/platform` 跑全案 → Stage2 专属文案卡出现蓝海/高亮 chips，文案含搜索向关键词  
2. 素材 Tab 上传教学/实操图 → 分析后生成分镜，flow log 含「拍摄手法」  
3. 决策智库点选选题扩写 → 文案含看板蓝海词  

---

## 交付

- 功能分支 push + PR → `main`（见本会话 `gh pr create` 输出）
- 本文件副本：`docs/2026Jul10/grokjobs-and-codes.md` 与 `~/Downloads/2026Jul10/grokjobs-and-codes.md`
