# Canvas 多方块连线 · 上游递归传递（PR #692）

> **状态**：✅ 已 merge `main`（`5e3ea90`，2026-07-03 ~20:29 UTC+8）

## 功能

在 `/canvas` 自由方块画布中，沿**有向连线**递归收集所有上游方块的：

- `prompt` / `outputText` 文案
- 图片素材（图生图参考）

支持 **A → B → C** 多级链路与菱形分叉；运行时合并为 `[上游 N]` 分段提示词，最近上游输出优先作图生图参考。

## 核心 API（`client/src/lib/canvasTypes.ts`）

| 函数 | 作用 |
|------|------|
| `resolveBlockHandoffText(block)` | 取方块可传递的文本（output 优先，否则 prompt） |
| `collectUpstreamBlockIds(blockId, blocks, edges)` | 沿入边递归收集上游 ID（去重、拓扑序） |
| `buildUpstreamHandoffContext(...)` | 合并上游文案 + 收集参考图 URL |

## UI

- `FreeformCanvas.tsx`：方块显示「已连接上游 N 个」提示
- 生成时自动注入上游 context，无需手动复制粘贴

## 测试

- `client/src/lib/canvasTypes.test.ts` — 9 项单测（多级链、分叉、空上游等）

## 验收

- [ ] A→B 连线后 B 生成可看到 A 的 output/prompt
- [ ] A→B→C 三级链路 C 收到 A+B 文案
- [ ] 菱形分叉（A→B、A→C）各自独立收集
- [ ] 上游图片可作为图生图参考

## 关联

- 画布基础：#686/#688（自由方块、菜单、缩放）
- 与平台迁移 #694 **独立**，可并行使用
