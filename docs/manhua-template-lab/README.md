# 漫剧节奏模板实验室

> **提案层**可自动写；**审定层**才进产品（`shared/manhuaViralTemplateBank.ts`）。

## 目录

| 路径 | 用途 |
|------|------|
| `proposals/*.json` | 待审 TemplateCard（`status: proposed`） |
| `sources.json` | 定时扫描的公开报道 URL 列表 |
| `CHANGELOG.md` | 提案/批准流水账 |
| [`../../shared/manhuaViralTemplateBank.ts`](../../shared/manhuaViralTemplateBank.ts) | 审定库（产品只吃 `approved`） |

## 流程

1. **贴链接 / 学这部**（Cursor Skill `manhua-viral-hits`）→ 写 `proposals/<id>.json`
2. **定时扫描** `pnpm run manhua:template-scan` → 只增/更新提案（公开报道）
3. **榜单学习 B+2**（推荐）：Platform「AI 漫剧」→ 导出 JSON / 学节奏 →  
   `pnpm run manhua:template-learn -- --rising-json <file> --rank N`  
   抽帧：前 5s + 每 10s；高潮窗每 3s → `downloads/manhua-template-learn/` + 提案草案  
   **语音（A）**：本机 mp3 → GCS 签名上传 → Fly `manhuaAudioClimaxScan`（secrets 里的 Gemini 3.5 Flash）
4. **人审批准**：明文「批准进库」后并入 `MANHUA_VIRAL_TEMPLATE_BANK`（`approved`）→ 编剧室节奏模板可选

### Fly 语音通路（本机不必直连 Google）

```bash
# 探针（部署含新 op 后）
curl -sS -X POST 'https://mvstudiopro.fly.dev/api/google?op=gemini35FlashPing' \
  -H 'content-type: application/json' -d '{}'

# 学习脚本默认走 Fly
pnpm run manhua:template-learn -- --video ./clip.mp4 --title "测试"
# MANHUA_LEARN_FLY_ORIGIN=https://api.mvstudiopro.com
```

## 禁止

- 自动把竞品片名、台词、画面抄进前台成稿
- 未批准提案出现在编剧室「节奏模板」列表
- 把下片/关键帧提交进 git（`downloads/` 已忽略）
- 把 Fly secrets 里的 Gemini key 拉回本机打印
