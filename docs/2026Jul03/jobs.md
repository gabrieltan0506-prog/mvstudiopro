# 2026-07-03 · Omni 视频画布（/canvas）

## 线上状态

| 项目 | 内容 |
|------|------|
| **PR** | [#678](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/678) ✅ 已合并 main（2026-07-02） |
| **正式 URL** | https://www.mvstudiopro.com/canvas |
| **路由** | `client/src/App.tsx` → `/canvas` |
| **页面组件** | `client/src/pages/OmniCanvas.tsx` |
| **内页顶栏** | `Navbar.tsx` → 「Omni 视频画布」 |

## 功能概要

- 节点式画布：文字 / 图片生成 / Omni 视频生成 / 视频抠像 / 图片编辑 + 高清放大
- 图片、视频 GCS 直传（`getVideoUploadSignedUrl` + `canvas/` 前缀）
- 后端：`server/services/geminiOmniInteractions.ts` + `api/google.ts`（`omniInteractionCreate` / `omniInteractionGet` / `omniMaterialUrl`）
- 模型：[gemini-omni-flash-preview](https://aistudio.google.com/prompts/new_chat?model=gemini-omni-flash-preview)
- **Seedance 2.5**：引擎切换 + 占位节点 + 画布扩展区（`runSeedance25Video` 占位），后续同页接入

## 首页入口（命名见 `canvas-home-naming.md`）

**#678 合并内容不含首页链接**；以下改动在本地 `feat/omni-canvas` 工作区，**未 commit**：

| 文件 | 改动 |
|------|------|
| `HomeNavbar.tsx` | 顶栏 nav + 用户菜单 → `/canvas` |
| `HomeHero.tsx` | `HERO_FLAGSHIP_LINKS` pill |
| `HomeFeatureCarousel.tsx` | `WORKFLOW_LINKS` |

若要在首页看到入口，需另开 PR 推送上述三文件。

## 待办（可选）

- [ ] 首页三文件 commit + PR（入口上线）
- [ ] Seedance 2.5 接入（替换占位）
- [ ] 统一首页/内页显示名（**非必须**，见 naming 文档）

## 关联文件

```
client/src/pages/OmniCanvas.tsx
client/src/lib/omniCanvasApi.ts
server/services/geminiOmniInteractions.ts
api/google.ts
```
