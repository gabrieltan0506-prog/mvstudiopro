# 人景物融合 + 动作双轨迹 + 运镜词表/服装道具

追加于分支 `feat/manhua-path-camera-promo-pack`（[#853](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/853)）。

## 交付

| 模块 | 文件 | 说明 |
|------|------|------|
| 图文融合子模板 | `shared/graphicNoteFusionTemplates.ts` | 6 条人景物双重曝光；`heroMode: "fusion"` |
| 图文接线 | `shared/infographicNoteTemplates.ts` + `InfographicTemplatePicker` | Platform 可选「人景物融合」分组 |
| 宣发对齐 | `shared/manhuaPromoCoverLayouts.ts` | `promo_09`–`promo_11` 水彩融合变体 |
| 动作运镜 | `shared/manhuaActionCameraRecipeBank.ts` | FPV / 打斗全景轨 / 红蓝双轨一镜 |
| 双轨标注 | `manhuaPathCameraAnnotate.ts` + `ManhuaPathCameraAnnotatePanel` | 红=人物、蓝=镜头 → Seedance 时段句 |
| 运镜词表 | `shared/manhuaCineVocabBank.ts` | 景别/支撑/运镜/光感；无导演名 |
| 服装道具连续 | `shared/manhuaWardrobePropContinuity.ts` | 6 套层衣+签名道具+材质锁 |
| 工厂 | `canvasDramaStudio.ts` / `OmniCanvas.tsx` | 点选注入 beats/clip/bible |

## 动作部分怎么用

1. **工厂下拉「动作运镜」**：按题材推荐或手选 1 条，注入分镜/成片节点（与路径运镜可叠加）。
2. **标注面板**：在关键静帧上用红点画人物路径、蓝点画镜头路径；选「红蓝双轨一镜」时编译为双轨 I2V 句。
3. **成片优先**：`compileI2VMotionPrompt` 优先消费 `pathAnnotationJson`（含 `actionRecipeId` + `trackRole`）。

## 合规

- Action 教程抽帧仅作内部研究，**不**提交 `action/*.mp4` 与帧 JPG。
- AI-CanvasPro 仅学公开演示语义，不抄 UI/预设。
- MIT 来源（Seedance skill / video-studio-skills）只提炼可拍词与连续性字段；**不**引入导演名 overlay、不粘贴外仓样例整段。
