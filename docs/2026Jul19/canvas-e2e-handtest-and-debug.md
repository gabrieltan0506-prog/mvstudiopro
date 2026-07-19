# Canvas 漫剧工厂 · 线上手测纪要 + Debug Mode（2026-07-19）

线上环境：`https://www.mvstudiopro.com/canvas?supervisor=1`  
浏览器：Cursor 内置浏览器；允许烧积分。

## 本轮闭环

| 步骤 | 结果 | 耗时/备注 |
|------|------|-----------|
| 题材 + 补充条件 | 江湖刀光打斗 + 雨夜客栈三句 brief | — |
| 扩写剧情（3 集） | 成功《雨停之前，谁先落刀》 | ~120s（`expandManhuaWriterPack`） |
| 确认并进入编导 | 成功解锁工厂按钮 | toast 原未标集号 |
| 跑到静帧 | 成功；成片坞 6 项可导出 | 焦点落在第 3 集（浏览 ep3 后确认） |
| 红蓝双轨 | 红 5 + 蓝 3 锚点；Dual-track 编译句出现 | 静帧解锁后可点选/画线 |

剧本质量（抽样）：三集片尾钩子齐全，刀光/暗箭/听雨令线连贯。

## 发现的问题（按优先级）

1. **人设/题材错位（P0）**  
   剧本角色为江湖刀客（沈砚秋 / 顾停舟），静帧却是都市办公女性（角色库仍停在沈清辞 × 傅临渊）。古风原型「雨夜江湖刀客」存在，但未自动压过都市库。

2. **焦点集易偏（P1）**  
   「确认并进入编导」使用当前 `writerFocusEpisode`；若先点开第 3 集再确认，整条工厂跑 ep3。本轮已在 toast 标明「第 N 集」。

3. **/canvas 缺 Debug（P1，本 PR 补）**  
   Platform / `/workflow` 有 Debug On；漫剧画布原先没有阶段日志与注入摘要，手测时看不清各步耗时与注入内容。

4. **前台技术泄漏（P2，本 PR 顺手收）**  
   扩写成功 toast / 编剧室副文案曾写模型名；已改为业务友好句。

5. **次要**  
   - 部分 demo 场景/道具图 404  
   - 运镜编译句「subject moves along red action path」重复偏多  
   - `api.mvstudiopro.com/api/health` 偶发 status 0

## Debug Mode（本 PR）

- 可见范围：`?supervisor=1` / localStorage supervisor / `admin` / `supervisor`
- 入口：画布顶栏「Debug On / Off」（不对一般用户展示）
- 内容（方案 A · 轻量日志板）：
  - 阶段日志：扩写 / 确认 / 工厂 start·stage·skip·retry·ok·error + 耗时 ms
  - 当前注入摘要：题材、焦点集、角色、古风原型、路径/动作配方、路径标注锚点与笔迹数、词表/服装等

未做：完整 request/response 透视（方案 B）、Debug 快跑入口（方案 C）——需要时可再开 PR。

## 建议下一轮

1. 江湖/古风题材自动换角或强提示「当前都市库与剧本冲突」  
2. 确认编导时默认回到第 1 集，或二次确认焦点集  
3. Omni 改视频节点闭环手测  
