---
id: home-motion-v3
title: Home 动效 V3（光标揭层 / 滚动控视频）
---

# Home 动效 V3

来源：HB `v3.pdf`（动效网站设计教程）。站内落地在营销首页，**不嵌入 Spline 第三方场景**（需独立 scene URL，另议）。

## 已落地

1. **光标揭层**（`HomeCursorReveal`）
   - 双海报图层；圆形光标遮罩揭示第二层
   - 指针跟随带轻微延迟；快速移动有短回声
   - `prefers-reduced-motion`：左右对半静态对比

2. **滚动控视频**（`HomeScrollVideo`）
   - sticky 全幅视频 + 约 320vh 滚动高度
   - 滚动进度同步 `video.currentTime`
   - 前景文案随进度显隐/位移；减动效时改为自动播放

## 未做（有意）

- **Spline.design 3D**：导出代码贴 Agent 的工作流，不属于站内可复用资产；有正式 scene 再议嵌入。
