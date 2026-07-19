# 漫剧合成长片 + 配乐 · 验收纪要

## 能力

- 成片坞「合成长片（含配乐）」→ `POST /api/jobs?op=manhuaAssembleFinal`
- 同源 `renderWorkflowFinalVideo`（fade + 9:16）+ 自动配乐
- 工作台露出：蓝轨/红轨状态、叙事灯光名称

## 线上手测清单

1. Debug On；确认编剧后工作台有专案设定
2. 静帧标注蓝/红轨 → clip prompt 含「蓝轨/红轨」跟轨句
3. 选叙事灯光 → beats/keyart prompt 含灯光块
4. 各集跑出 clip 后点「合成长片（含配乐）」→ 得长片预览
5. 前台文案无供应商名

## 已知边界

- 蓝红线/灯光为生成期注入，服从度取决于成片模型
- 无 clip 的集会 skip，不阻断有 clip 的合成
