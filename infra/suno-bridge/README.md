# Suno cookie 桥（内部专用）

上游：gcui-art/suno-api，钉在 `a2e6a823`（2026-03-06）。用浏览器 cookie 冒充网页调 `studio-api.prod.suno.com`，
每次生成过一次 hCaptcha（2Captcha 付费解）。**违反 Suno 条款、会封号**：只给内部账号用，不接付费用户。

## 部署（一次）
1. 用户在 Fly 上建应用并放密钥（我不碰钥匙）：
   fly apps create mvstudiopro-suno-bridge
   fly secrets set -a mvstudiopro-suno-bridge SUNO_COOKIE='…' TWOCAPTCHA_KEY='…'
2. 部署：cd infra/suno-bridge && fly deploy -a mvstudiopro-suno-bridge
3. 主站 mvstudiopro 加 secret：SUNO_BRIDGE_URL=http://mvstudiopro-suno-bridge.internal:3000
   （可选，网页代号 0910 已对照确认）SUNO_BRIDGE_MODEL_V6_MINI=chirp-goose  SUNO_BRIDGE_MODEL_V6=chirp-hawk  SUNO_BRIDGE_MODEL_V6_WILD=chirp-hawk-wild

## 主站怎么用
配乐间「配乐来源」下拉只对 admin/supervisor 显示，默认 Suno v6（Pro 账号）；服务 `server/services/sunoBridgeMusic.ts`。
桥接口：POST /api/custom_generate {prompt, tags, title, make_instrumental, model, wait_audio:false, negative_tags}
→ 返回两条 clip；GET /api/get?ids=a,b 轮询到 status=complete 取 audio_url。

## 已知限制
- 没有 duration 参数（网页 v2 接口无此字段）；仍整曲生成后按段表裁。
- cookie 会过期，桥 502/401 时换新 cookie 重设 secret。
- 上游钉死提交，Suno 前端一改可能失效；升级时改 Dockerfile 的 SUNO_API_COMMIT 再 deploy。0910 已为 v6 改版打了两处选择器补丁（textarea / "Create song"），再改版就改 Dockerfile 里那段 sed。


## 0910 实测状态与接手说明
- 已通：部署、cookie（须 `__client` + `__session`）、`/api/get_limit`（Pro 2500 点）。
- 未通：`getCaptcha()`。上游用无头浏览器在 create 页触发 hCaptcha 再截图给 2Captcha；Suno v6 改版后点 Create 一分钟内没有 hCaptcha 图片请求（`No hCaptcha request occurred within 1 minute`），令牌拿不到，生成发不出去。本 Dockerfile 已打三处 v6 补丁（textarea 选择器、"Create song"、拦截 `/api/generate/v2*`），仍差验证码触发这一步。
- 页面事实：sitekey `d65453de-3f1a-4aac-9366-a0f06e52b2ce`（非 enterprise）；生成请求 `/api/generate/v2-web/`；输入框为唯一可见 `textarea`；Create 按钮 `aria-label="Create song"`，空输入时 disabled。
- 接手要改的是上游 `src/lib/SunoApi.ts` 的 `getCaptcha()`（构建时补丁），方向见 `2026Sep10/交接报告-0910.md` 第九节；改完 `fly deploy` 后按 get_limit → custom_generate → get 的顺序验通，再给主站设 `SUNO_BRIDGE_URL`。
