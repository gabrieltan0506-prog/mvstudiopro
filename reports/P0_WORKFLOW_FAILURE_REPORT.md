# MVStudioPro P0 错误报告（Workflow 部署事故）

## 事件级别
P0（生产环境不可用）

## 事故时间
2026-03-08 ~ 2026-03-09

## 直接影响
- /workflow 页面 404
- Workflow Engine 未实际可用
- Script → Storyboard → Video 链路未跑通
- UI 无法完成用户验收

## 事故根因

### 1. 偏离用户工程要求
用户明确要求：

- 不在本地部署 API Key
- 统一从 Vercel 环境变量读取
- 不使用临时 fallback 方案
- Workflow 必须先跑通再做 UI

开发过程中未完全遵循这些约束。

### 2. 环境变量读取方式错误
代码改为读取本地 `.env.local`：
导致调试复杂度上升。

## 技术教训

1. Workflow Engine 必须先单独稳定。
2. Router 与 Model Provider 必须隔离。
3. 环境变量只允许 **Vercel Runtime 读取**。
4. Serverless 函数数量必须控制。

## 修复策略

### 第一阶段（立即）
- 修复 serverless import
- 统一 env 读取
- 保证 workflow API 可运行

### 第二阶段
- Script → Storyboard → Image → Video 完整链路

### 第三阶段
- UI 接入 Workflow Engine

## 当前状态
Workflow Engine 基础代码已存在，但生产环境未完全稳定。
