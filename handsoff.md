# Handoff：平台頁封面 / NB2 / GCS 與後續回退說明

**最後更新（仓库快照）：** `origin/main` = `db16d7b`  
**使用者明确交代：** 本次**先不要**在远端执行回滚；若决定放弃调试、要回到 **PR #488 合入后** 的状态，用下文「回退到 #488」一节（目标提交 **`e703894`**）。

---

## 1. `main` 上相关合并顺序（从早到晚）

| 顺序 | Commit     | PR   | 简述 |
|------|------------|------|------|
| 1    | `e703894`  | #488 | NB2 监管封面、生存模式环境变量与影像 prompt 对齐 |
| 2    | `16a07ba`  | #489 | 一键分镜/八格入口与定价、战略全景 logo、NB2 配图链路等 |
| 3    | `db16d7b`  | #490 | NB2 直写 GCS/Fly、前端轮询 success 判定、`referrerPolicy=no-referrer`、gemini-image 观测日志 |

「回退到 488」= **让 `main` 的内容与 `e703894` 一致**，而不是只撤 #490（那样的话 #489 仍在）。

---

## 2. 已踩坑与根因摘要（给接手人）

### 2.1 图生成了但浏览器不显示（403 / 空白）

- **现象：** 日志里 NB2 成功，但有 `mirror_fetch_http_403`，或前端封面区不渲染。
- **后端：** Vertex 返回 inline base64 后，若先 `storagePut` 到**私密** R2/S3，再用**匿名 fetch** 镜像到 GCS 会 403；返回给前端的 URL 往往无法在 `<img>` 里加载。
- **修复方向（#490 / `gemini-image`）：** 优先把 inline 字节写到 **GCS V4 读签名** 或 **Fly 卷公开 URL**（与 GPT-IMAGE-2 主路径一致），再兜底 `storagePut`。
- **前端：** `TrialWatermarkImage` 增加 **`referrerPolicy="no-referrer"`**，减少部分存储依赖 Referer 拦截嵌入导致的裂图。
- **前端：** 轮询 job `output` 时，**勿**仅靠 `Boolean(o.success) && imageUrl`；若字段缺失会导致不写 `platformImageMap`（卡片永远无图）。已改为「有 URL 且 `success !== false`」等逻辑（见 #490）。

### 2.2 环境变量与存图驱动

- **`PLATFORM_IMAGE_STORAGE`：** `fly` vs `gcs`（默认 GCS）决定 Vertex 出图后写 Fly 卷还是 GCS；日志里若没有 GCS 文案，可能是走了 Fly。
- **观测：** `generateGeminiImage` 可选 `imagePersistFlowLog` 写入平台 `imageGenFlowLog`，便于 Debug 面板对齐服务端步骤。

### 2.3 合并冲突史

- `server/services/proxyImageService.ts`、`runPlatformTopicImagePipeline.ts` 曾与 `main` 冲突；解决时保留 **NB2 → 无图则 GPT-IMAGE-2 → 仍无图则版式+NB2** 的监管封面链（与「仅 NB2+版式」的 main 一侧合并）。

---

## 3. 重要分支与 PR

- **功能长分支：** `feat/decision-dashboard-home-hero-ui`（历史上含多批 UI + 平台影像改动；#489/#490 可能由此拆出合并）。
- **PR #489：** 已合入 `main`（`16a07ba`）。
- **PR #490：** 已合入 `main`（`db16d7b`）。
- 若需在 GitHub 上「关掉」490：应用下面回退流程，而不是只 revert 490 的 commit（除非你也想保留 #489）。

---

## 4. 回退到 PR #488（`e703894`）— **需人工确认后再做**

> 使用者当前要求：**先不要**对生产/main 做回滚。下面命令供**决定回滚时**使用。

### 方案 A：Revert 两个 squash 提交（推荐，历史可审计）

在最新的 `main` 上、**从新到旧** revert 两次（均为单 parent，普通 `git revert` 即可）：

```bash
git checkout main
git pull origin main
git revert db16d7b --no-edit   # 撤 #490
git revert 16a07ba --no-edit   # 撤 #489
git push origin main
```

完成后树应对齐 **`e703894`**（PR #488 之后的状态）。若有冲突，按文件解决后再提交。

### 方案 B：硬指到 #488（改写历史，需团队同意 + `force-with-lease`）

```bash
git checkout main
git pull origin main
git reset --hard e703894
git push origin main --force-with-lease
```

**风险：** 所有已拉取 `16a07ba`/`db16d7b` 的 clone 需重新同步。

---

## 5. 关键文件索引（调试入口）

| 区域 | 路径 |
|------|------|
| Vertex NB2 出图 + 存盘 | `server/gemini-image.ts` |
| GPT-IMAGE-2、镜像 GCS、NB2 兜底 | `server/services/proxyImageService.ts` |
| 平台单帧管线 | `server/services/runPlatformTopicImagePipeline.ts` |
| 平台页封面 / 轮询 / platformImageMap | `client/src/pages/PlatformPage.tsx` |
| 试用水印图 + referrer | `client/src/components/TrialWatermarkImage.tsx` |
| Fly 卷公开 URL | `server/services/flyVolumeGeneratedImages.ts` |
| Jobs 轮询 API | `server/_core/index.ts`（`GET /api/jobs/:id`）、`server/jobs/repository.ts` |
| 客户端轮询 | `client/src/lib/jobs.ts` |

---

## 6. 建议的下一步（若继续修而非回滚）

1. 在生产日志确认：Vertex 存图走的是 **GCS 还是 Fly**，以及最终 `imageUrl` 域名。
2. 浏览器 Network：封面请求 **HTTP 状态**（403/404/CORS）与 **Request URL** 是否带鉴权参数。
3. 若仅想撤影像相关补丁而保留 #489 UI：需要用 **选择性 revert** 或手工挑 commit，比整段回滚到 488 更费工夫。

---

## 7. 对用户的说明（一句话）

**当前未对远端做任何回滚。** 若你确认「不要 #489 + #490，只要 #488」：按上面 **§4 方案 A** 执行即可；若仍想保留 #489 只要修 bug，则不要整段回退到 `e703894`，应新开分支从 `main` 做针对性修复或部分 revert。
