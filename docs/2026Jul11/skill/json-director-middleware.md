---
id: json-director-middleware
name: JSON导演中台（生图）
description: JSON 锁摄影→LLM 翻译→Nano/GPT 生图；禁止直接喂 JSON；成稿去导演名
version: 2026-07-16
defaultEnabled: true
---

# JSON 导演中台 Skill

## 用途
生成**封面 / 分镜静帧 / 画布·创作台生图**英文提示词时启用。把「导演思维」收成 JSON 中台，再交给 LLM 译成绘图模型爱读的自然语言——**不要把 JSON 直接丢进生图框**。

样本与公开教程：`~/Downloads/2026Jul16/json.mp4`（刺猬星球 super-i）· [info-2570](https://www.super-i.cn/info-2570.html) · [info-2574](https://www.super-i.cn/info-2574.html)。  
运行时实现：`shared/jsonDirectorMiddleware.ts`（Canvas / Creative 已接线）。

## 工业链路（硬）
1. **美学词库**：胶片介质（Kodak Vision3 / grain / halation）、镜头（anamorphic / telephoto）、光影（volumetric / Rembrandt / window）、色彩。  
2. **JSON 中台**字段（逻辑锁）：
   - `Project_Settings`：画幅、分辨率气质、渲染、negative（无字、无锐化糖衣）
   - `Subject_Core`：**锚点优先**（脏脸/情绪/发型等不可被「赛博精品妆」吞掉）
   - `Environment_Layer`：地点、时段、空气介质
   - `Cinematography_Lock`：机身、镜头、胶片、布光、构图、调色（**必须主导**最终 prompt）
3. **LLM 翻译**：按目标模型输出——Nano/GPT 用画面感英文段落；勿输出 Markdown 围栏与解释。  
4. **成稿去名**：禁止导演名、片名、「向某某致敬」「某某风」。对称粉彩画册感可用手法词，不点名。

## 误区（2574）
- JSON **不是**美颜滤镜；审美内容决定上限，结构只降随机。  
- 直接喂 MJ/SD/香蕉 JSON 语法会当噪音甚至画出括号乱码。  
- 系列图：锁 `Cinematography_Lock`，只轮换 `Subject_Core` / `Environment_Layer`。

## 选题 / 封面文案侧怎么用
- 写视觉 brief 时先列四块锁，再让模型产出英文生图句。  
- 需要「画册对称 / 粉彩」时写手法，不写导演。  
- 与 `director-craft` 并存：本 Skill 管**静帧编译**；`director-craft` 管成稿灯光运镜手法卡。
