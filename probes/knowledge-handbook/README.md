# 图文知识手册隔离探针请求

推送 `request.json` 触发 `.github/workflows/knowledge-handbook-probe.yml`：在既有 rig 工作机上运行本分支打包的正式代码。

- `prepare`：只建立/核对本次云稿与配图复用关系，不调用模型。
- `start`：挂载正式出版组件，由正式代码完成审校、整册核对、排版与导出；探针不补回执、不改状态、不代做内容。
- `status`：只读查询阶段与页数。

公开仓库：日志只输出阶段与计数；成品保存在用户云稿与 GCS，不作为 Actions 附件。

- `recipient.pub.pem`：请求方公钥，工作流用它加密回传输出（配对私钥在请求方本机，不入库）。
- `rig.pub.pem`：工作机 `/app/isolated/.transfer-key.pem` 的公钥（2026-11-09 直连 keygen 生成），本地用 `knowledge-probe-transfer.mjs encrypt` 加密 EPUB 等输入时使用；工作机重部署会丢私钥，需重新 keygen 并更新本文件。
