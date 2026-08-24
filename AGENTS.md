# mvstudiopro Agent 硬规则

本仓库所有 agent 开工前必须读取 `.cursor/rules/*.mdc` 与 `CLAUDE.md`。其中 `.cursor/rules/product-guardrails-always.mdc` 的“生产凭证只留 Fly”是不可覆盖的硬红线：

- 生产 API 密钥、Cookie、云凭证和服务账号只保存在 Fly secrets / 服务端环境。
- 本机、浏览器、前端、CLI、探针、测试、交接档和对话不得承载或导出真实凭证。
- 本机工具只能调用已鉴权的 Fly API；真实上游调用由 Fly 服务端完成。
- 缺少 Fly 入口时停手或补服务端入口，禁止要求用户把生产密钥配置到本机。

其余开发、验证、Git 与产品规则以 `.cursor/rules/*.mdc` 为真源。
