# 漫剧工厂 · 产品简报（Agent 必读）

> 更新：2026-07-24。主战场：`/canvas` 漫剧创作模式（非 `/platform` Skill 池）。  
> 老板验收偏「看得见的成片提示词 / 画布节点 / 出片成本」；空话与假锁会被骂。

## 1. 北极星

把「题材 → 编剧室 → 资产 → 分镜静帧 → 段成片（Seedance）」做成**可审、可锁脸服场、可控调用次数**的 Web 工厂。  
对标阿硕桌面演示的阶段感，但走自有画布 + 导演中台；**禁止**抄闭源文案/UI，**禁止**前台泄漏模型/供应商名。

## 2. 预算期硬约束（现行）

| 项 | 口径 |
|---|---|
| 单集段数 | **5–6 段 × 约 15s**（非 10–12；控 Seedance 次数） |
| 每段参考 | 人物静帧约 3–4 + 场/道/服约 2–3；语音 **0–3 可选，缺音不挡出片** |
| 成片提示词 | 秒轴短指令 + 垫图/@Image；**禁止**规则墙 / 古风板 / 导戏长文灌水 |
| 画风 | **有垫图后禁止再写「画风：CG 漫剧」**；画风跟图走 |
| 测试探针 | 一律 Seedance **2.0 Mini · 480p**（见 `seedance-probe-always`） |
| 部署 | API **只认 Fly Deploy success**；Vercel 红灯可忽略 |

## 3. 成片提示词验收（用户反复验过）

**必须**

- 本段出场角色来自**可拍表「角色：」/ 对白说话人真名**，禁止库序软取前两人（曾错锁「马县丞/苏文谦」）
- 本段场景有 **【场景锁】**（地名 + 说明 + 锁垫图/@场景）；道具仅点名才进对照
- 每镜秒轴列出：**动作轨迹 / 运镜轨迹 / 景别 / 光 / 氛围** + 对白
- Image 对照 ≤ 本段子集（角色封顶约 4）；未点名不灌全库道具

**禁止**

- 「画风：…」、整集 7 人灌进 15s、错场（断月桥 vs 雪关粮仓）
- 模板刷屏（如每镜同一「眼神由惊转硬」占位却无说话人）
- 把网址写进用户可见 prompt

## 4. 画布 UI 口径

- **角色 / 场景 / 道具 / 关键静帧**节点：中间**只图 + ID**，不重复整段提示词
- **成片 `clip-*` 节点**：中区主视觉 = **本段垫图缩略图**；秒轴提示词为次要矮编辑区
- 悬浮 FAB 避开右下（见 `floating-ui-zones-always`）

## 5. 关键代码（改成片/资产先看这些）

| 职责 | 路径 |
|---|---|
| 工厂铺点 / 段成片组装 | `client/src/lib/canvasDramaStudio.ts` |
| 画布节点 UI | `client/src/components/canvas/FreeformCanvas.tsx` |
| 工作台 / 审阅成片 | `client/src/components/ManhuaScriptWorkbench.tsx` |
| Image 对照 / 本段白名单 | `shared/manhuaAssetLockRegistry.ts` |
| 秒轴 / 场景光影板 | `shared/manhuaClipDialogueTimeline.ts` |
| 可拍表解析 | `shared/manhuaEpisodeSegmentPlan.ts` |
| 成片消毒（剥规则墙/画风） | `shared/manhuaClipPromptSanitize.ts` |
| 段注入入口 | `shared/manhuaScriptWorkbench.ts` → `formatWorkbenchSegmentClipInjectBlock` |

## 6. 协作（摘要）

完整条文：`.cursor/rules/user-instruction-priority-always.mdc`。  
要点：用户最新明文 > 门禁；指令打架先复述再动手；push ≠ 开 PR；Deploy 红自修。

## 7. 勿当作现行目标的文档

- 过期过夜 TDL：`docs/2026Jul16/manhua-factory-overnight-tdl.md` 等（可考古，勿当本周 KPI）
- Skill 里仍写「6–10 镜 / 完整导戏单」的旧句：以**本简报 §2–3** 与代码为准，改代码时顺手改 Skill
