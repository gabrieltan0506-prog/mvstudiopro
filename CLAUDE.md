# mvstudiopro · agent 开工四行令

1. 动手前读 `.cursor/knowledge/kb/INDEX.md`，按当前任务挑 1–2 个主题文件读，不全读。
2. 碰积分/扣费先读 `kb/billing.md`；碰生图/视频/LLM 通道或任何烧钱批次先读 `kb/channels.md`；推送/合并/验收先读 `kb/deploy-verify.md`。
3. 规则真源 = 持久记忆 work-rules 与 `.cursor/rules/*.mdc`（alwaysApply）；本文件与 kb 只放事实，不放规则。收班五分钟更新 `kb/line-*.md`。
4. 开工前必须读取 `.cursor/rules/product-guardrails-always.mdc`：生产 API 密钥、Cookie、云凭证与服务账号只留 Fly secrets / 服务端环境；本机和旁路探针只能调用已鉴权的 Fly 服务端入口，任何 agent 都不得要求本机配置、导出或读取生产凭证。
