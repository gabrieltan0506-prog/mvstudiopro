# Seedance 2.5 接入骨架（未开放）

EvoLink 文档标注 Seedance 2.5 **尚未上线**。本仓库已写好三模式调用，默认闸门关闭。

| 版本 | 模式 | model id | 时长 |
|---|---|---|---|
| 2.0 | text / image / reference | `seedance-2.0-*-to-video` | 4–15s（产品默认 **15s**） |
| 2.5 | text / image / reference | `seedance-2.5-*-to-video` | 4–30s（产品默认 **15s**） |

## 闸门

- `shared/seedanceEvolinkModels.ts` → `SEEDANCE_25_PUBLICLY_ENABLED = false`
- 联调：`SEEDANCE_25_ENABLED=1`
- API：`POST /api/jobs?op=seedance25`（未开放时 503 + Coming soon）
- 画布 `/canvas`：展示 **Seedance 2.5 Coming soon on MV Studio Pro**

## 上线 checklist

1. 确认 EvoLink 控制台已开通 2.5 三模型  
2. 将 `SEEDANCE_25_PUBLICLY_ENABLED` 改为 `true`（或生产 env 打开）  
3. Canvas 去掉 Coming soon，把 `seedance-2.5` 加入可选视频模型  
4. 跑 `pnpm run canvas:probe` / 实机文生·图生·参考生各一条  
