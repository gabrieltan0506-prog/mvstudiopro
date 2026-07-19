# 路径运镜标注 + P3 入库包

分支：`feat/manhua-path-camera-promo-pack`（与 #852 古风原型包分离）

## 交付内容

| 模块 | 文件 | 说明 |
|------|------|------|
| 路径运镜配方 | `shared/manhuaPathCameraRecipeBank.ts` | 8 条分阶段配方（脚到脸 / 环绕落脸 / 证据推轨 / 对峙侧跟 / 打斗短阶段等） |
| 路径标注 | `shared/manhuaPathCameraAnnotate.ts` + `client/src/components/ManhuaPathCameraAnnotatePanel.tsx` | 静帧点击锚点（3–8）→ Seedance 时段句 |
| I2V 优先 | `shared/jsonDirectorMiddleware.ts` | `pathAnnotationJson` / `pathCameraRecipeId` 优先于启发式运镜 |
| 叙事灯光 | `shared/manhuaNarrativeLightingBank.ts` | 安全→危险→真相→崩塌→决断等 8 条 |
| 男发预设 | `shared/manhuaMaleHairstylePresetBank.ts` | 18 条结构化发型（无社媒原图） |
| 男生微表情 | `shared/manhuaMaleMicroExpressionBank.ts` | 10 条高张力微表情 |
| 宣发封面 | `shared/manhuaPromoCoverLayouts.ts` | 8 条人景双重曝光等构图；独立 `promo_cover` 节点 |
| 工厂接线 | `canvasDramaStudio.ts` / `OmniCanvas.tsx` | 点选注入 + 标注面板 |

## AI-CanvasPro 合规边界

公开仓库 [ashuoAI/AI-CanvasPro](https://github.com/ashuoAI/AI-CanvasPro) 为**双许可 / 非 OSI 开源**：

- **可用**：公开 README / 演示视频中的工作流**想法**（路径编号、镜头与主体分写、脸参考等），由本仓库**自研**数据与 UI 重写。
- **不可用**：嵌入其 Electron 应用、抄其源码/预设/像素级 UI、二次分发或 SaaS 集成该软件。

本包的路径标注为自研交互（卡片式锚点编辑），不复刻其红线工具栏。

## 使用提示

1. 漫剧工厂编导区选择「路径运镜配方」，或在静帧生成后用标注面板点路径。
2. 叙事灯光 / 微表情注入节拍与静帧；男发注入角色圣经；宣发构图另铺封面节点。
3. Seedance 成片运行时，`compileI2VMotionPrompt` 会优先使用标注 JSON 或配方时段句。
