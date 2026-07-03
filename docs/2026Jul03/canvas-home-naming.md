# /canvas 在首页的显示名称（记录 · 不改动）

> 用户确认：**功能不受影响则不改名**。本文仅记录现状，避免后续接手时重复问。

## 正式路径

- URL：`/canvas`
- 页面内 H1：**Omni 视频创作画布**

## 各入口当前文案（不一致但可接受）

| 位置 | 显示名称 | 文件 |
|------|----------|------|
| 内页顶栏 `Navbar` | **Omni 视频画布** | `client/src/components/Navbar.tsx` |
| 首页顶栏 nav（中/英） | **Omni 画布** / Canvas | `HomeNavbar.tsx` `nav[]` |
| 首页用户下拉菜单 | **Omni 视频画布** | `HomeNavbar.tsx` |
| Hero 首屏快捷 pill | **Omni 视频画布** | `HomeHero.tsx` `HERO_FLAGSHIP_LINKS` |
| 功能轮播区底部链接 | **Omni 视频画布** | `HomeFeatureCarousel.tsx` `WORKFLOW_LINKS` |

## 结论

- 「Omni 画布」≈ 短称（顶栏空间有限）
- 「Omni 视频画布」≈ 完整产品名（Hero / 轮播 / 内页）
- **无需为统一文案开 PR**，除非产品明确要求 rebranding。

## 备注

- 首页入口改动截至 2026-07-03 仍在本地，未进 #678；合并 #678 后线上仅能通过**直接访问 `/canvas`** 或**内页 Navbar** 进入，首页尚无链接（部署 homepage PR 前）。
