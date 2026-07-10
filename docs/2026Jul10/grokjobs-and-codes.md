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

- 功能分支 push + PR → `main`：https://github.com/gabrieltan0506-prog/mvstudiopro/pull/731
- 本文件副本：`docs/2026Jul10/grokjobs-and-codes.md` 与 `~/Downloads/2026Jul10/grokjobs-and-codes.md`

---

## 续：封面 / 分镜人物造型优化（国际时尚大片）

> 追加于同分支 PR #731 · 覆盖**全案选题**与**自定义选题**的封面单帧 + 2×4 分镜人物生成

### 人物生成要求（产品口径）

1. 配合场景生成合适且高雅/高贵的穿搭  
2. 整体风格参考《VOGUE》《ELLE》《Harper's Bazaar》、好莱坞时尚编辑  
3. 人物：高级、时尚、自信、明星感；自然微笑或冷淡高级表情；妆容干净、皮肤细腻通透有真实纹理；头发自然舒展带电影空气感  
4. 服装：深蓝/黑/奶油白/灰等高级配色；西装、礼服、西装裙、高定外套、丝绸衬衫等；羊毛/丝绸/缎面/天鹅绒质感；轻奢配饰可点缀勿硬配，男女款式区分  

### 代码

**共享常量**：`shared/platformFashionEditorialCharacter.ts`

```ts
export const PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH = `【人物造型·国际时尚大片】...`;
export const PLATFORM_FASHION_EDITORIAL_CHARACTER_EN = "VOGUE / ELLE / Harper's Bazaar / ...";
export function appendFashionEditorialCharacterGuidance(base, opts?): string;
```

| 注入点 | 文件 | 作用 |
|--------|------|------|
| 全案封面 persona | `PlatformPage.buildCoverPersonaContextForImageGen` | IP/人设后叠加时装大片块 |
| 自定义封面/分镜 persona | `PlatformPage` 自定义选题 `coverPersona` | 主人公特质 + 时装大片块 |
| 封面中文直送 | `buildPlatformTopicCoverDirectChinesePrompt` | 身份锚点强制含时装约束 |
| 封面管线兜底 | `runPlatformTopicImagePipeline` | `coverPersona` 再 append 一次（去重） |
| 企划大脑 | `agenticCoverWorkflow.buildCoverTaskInputFromPipeline` | 文案侧提醒时装气质 |
| 摄影英文 modifiers | `PLATFORM_SHARED_IMAGE_PHOTOGRAPHY_MODIFIERS` | 英文链叠加入时装编辑语汇 |
| 2×4 分镜 | `generatePlatformCompositeSheetImage` + `appendStoryboardProtagonistAnchorToScript` | 无论是否有参考人像均注入；中文八格模板要求对齐 |
| Stage2 文案 | `buildPlatformContent` environmentAndWardrobe 示例 | 引导脚本写出高定穿搭 |

### 手测补充

4. 全案执行卡生成封面 → 人物穿搭贴合场景、杂志大片气质  
5. 自定义选题上传人像生成封面+分镜 → 同脸 + 高级时装造型，配饰不堆砌  
6. **3×4 十二格**（全案批量 / 自定义切换）→ 三段横排均含时装大片 + 拍摄手法；跨段同人同布光；flow log 含「时装大片+拍摄手法共享约束」

---

## 续：3×4 分镜沿用人物造型与拍摄手法（完工）

> 同分支 PR #731 · 3×4 与 2×4 **同一套**规则，分段切脚本时不丢约束

### 问题

3×4 会把 `scriptContext` 切成 2–3 段再分别生图；若共享约束只在全文末尾，后段可能丢失时装大片 / 机位说明。

### 修复

**文件**：`server/services/proxyImageService.ts` → `generatePlatformGridStitchedSheetImage`

- 切段前组装 `sharedRules`：`PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH` + `executionDetails` + `shootingTechniqueBrief` + 跨段连贯说明  
- **每一段**前置该共享块后再送 `generatePlatformCompositeSheetImage`  
- `MULTI-PART LONG SHEET` 英文指令补充 CHARACTER & SHOOTING CONTINUITY（与 2×4 同口径）  
- `buildCompositeSheetDirectChineseBody(..., { rowBand: true })`：中文主体改为「1 行×4 格」并写明时装大片 + 拍摄手法对齐  

**套装链路**：`compositeShootingTechniqueBrief` 入队 → worker 传入 2×4/3×4 生图；客户端批量/单卡/自定义套装均带上 `shootingTechniqueBrief`。

```ts
// 3×4 每段前置（示意）
const sectionScript = `${sharedRules}\n\n【本段分镜内容 · 第 ${i + 1}/${realTotal} 横排】\n${parts[i]}`;
await generatePlatformCompositeSheetImage({ ...options, scriptContext: sectionScript, gridSection: { index: i, total: realTotal } });
```
