# 图文知识手册隔离探针请求

推送 `request.json` 触发 `.github/workflows/knowledge-handbook-probe.yml`：在既有 rig 工作机上运行本分支打包的正式代码。

- `prepare`：只建立/核对本次云稿与配图复用关系，不调用模型。
- `start`：挂载正式出版组件，由正式代码完成审校、整册核对、排版与导出；探针不补回执、不改状态、不代做内容。
- `status`：只读查询阶段与页数。

公开仓库：日志只输出阶段与计数；成品保存在用户云稿与 GCS，不作为 Actions 附件。
