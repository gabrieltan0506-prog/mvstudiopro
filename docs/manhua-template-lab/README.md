# 漫剧节奏模板实验室

> **提案层**可自动写；**审定层**才进产品。动态批准写 GCS，**不必**改 TypeScript 种子数组。

## 目录

| 路径 | 用途 |
|------|------|
| `proposals/*.json` | 本地/扫描提案（可选；云端以 GCS 为准） |
| `sources.json` | 定时扫描的公开报道 URL 列表 |
| `CHANGELOG.md` | 提案/批准流水账 |
| [`../../shared/manhuaViralTemplateBank.ts`](../../shared/manhuaViralTemplateBank.ts) | 出厂种子库 + 合并/解析助手 |
| GCS `manhua-template-learn/proposals/` | 云端学习提案 |
| GCS `manhua-template-learn/approved/` | 人审通过的动态审定库 |

## 流程

1. **Platform「学节奏」**（推荐）：飙升榜一点 → 云端 Job 下片+语音+读帧 → GCS `proposed`  
   失败自动回退本机 `manhua:template-learn` 命令
2. **本机学习**（回退）：`pnpm run manhua:template-learn -- --url …` / `--rising-json …`
3. **定时扫描** `pnpm run manhua:template-scan` → 只增/更新提案
4. **人审批准**：Platform「批准进库」或 tRPC `manhuaViralTemplate.approve` → GCS `approved/`  
   编剧室列表 = 种子 ∪ GCS（同 id 以 GCS 为准）

### 云端 Job

- action：`manhua_template_learn`（`POST /api/jobs`，监管门禁）
- 服务：`server/services/manhuaTemplateLearnService.ts`

```bash
# 备用本机
pnpm run manhua:template-learn -- --video ./clip.mp4 --title "测试"
```

## 禁止

- 自动把竞品片名、台词、画面抄进前台成稿
- 未批准提案出现在编剧室「节奏模板」列表
- 把下片/关键帧提交进 git（`downloads/` 已忽略）
- 把新模板硬编码进 `MANHUA_VIRAL_TEMPLATE_BANK` 当唯一进库方式
