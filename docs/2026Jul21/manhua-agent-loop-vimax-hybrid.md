# 漫剧创作顾问：A 壳 + Agent Loop 混合（内部）

> 用户可见文案一律用「创作顾问 / 会话 / 产物」。本文可写内部实现细节。

## 架构

| 层 | 职责 |
|----|------|
| UI（方案 A） | `/canvas` + `ManhuaScriptWorkbench` + `ManhuaAgentAdvisorPanel` |
| Node 桥 | `manhuaAgentLoop` tRPC；`/api/internal/manhua-agent-bridge/*` |
| Python sidecar | `services/vimax-agent`：vendored `agent_runtime` + Idea/Script **规划段** |
| 本站生成 | 静帧/成片仍走工厂 `chargeStep` + `api/jobs`（含 Seedance Mini·480p 探针档） |

**硬边界**：不调用 vendored `RenderBackend` / `vimax_render_video`。出图出片 tool 只入队 host pending action，由工作台 CTA/工厂扣费执行。

## 归属

- Upstream：HKUDS/ViMax（MIT），见 `services/vimax-agent/NOTICE` 与 `vendor/vimax/LICENSE`。
- 子集：`agent_runtime/`、`agents/`、`pipelines/`（规划）、`interfaces/`、`prompts/`、`tools/`（import 所需）。

## 环境变量

| 变量 | 用途 |
|------|------|
| `MANHUA_AGENT_SIDECAR_URL` | Node → sidecar，如 `http://127.0.0.1:8091` |
| `MANHUA_AGENT_BRIDGE_TOKEN` / `HOST_BRIDGE_TOKEN` | 双向鉴权 |
| `HOST_BRIDGE_URL` | sidecar → Node，如 `http://127.0.0.1:3000` |
| `MANHUA_AGENT_WORKSPACE` | sidecar 会话磁盘根 |
| `VIMAX_LLM_*` | sidecar Agent Loop 的 OpenAI-compatible LLM（服务端，不对用户暴露） |

未配置 `MANHUA_AGENT_SIDECAR_URL` 时：`manhuaAgentLoop.status.available === false`，工作台降级为无顾问的一键工厂路径。

## 验收清单

1. 对话可 resume：同浏览器 `localStorage` 存 session id；刷新后 `getSession` 仍可读产物。
2. Idea/Script 规划后产物栏与分镜列表出现角色/节拍（sync → story/beats/reverse `outputText`）。
3. 出静帧/成片只走本站积分与 jobs；sidecar 日志无 RenderBackend 调用；bridge 响应含 `renderBackend: "host_jobs"`。
4. 前台无上游项目名 / 供应商堆砌。
5. sidecar 挂掉：顾问面板提示暂不可用，确认简报 → 静帧 → 成片仍可用。

## 首期不做

Novel2Video / AutoCameo / VLM best-of-k；ViMax Web provider 设置页不挂给一般用户。

## 本地启动 sidecar

见 `services/vimax-agent/README.md`。
