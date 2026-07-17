---
name: seedance-probe
description: Seedance 成片探针（默认关；CANVAS_PROBE_SEEDANCE=1 才真打）
---

# Seedance 成片探针

- 默认：`pnpm run manhua:seedance-probe` → SKIP，不烧额度
- 开启：`CANVAS_PROBE_SEEDANCE=1` + `CANVAS_PROBE_IMAGE_URL=`
- 默认档：2.0-mini · 5s · 480p（shared/seedanceEvolinkModels）
- 密钥在 Fly，本机勿指望直连
- 默认档解析：`resolveSeedanceProbeDefaults`（shared）
