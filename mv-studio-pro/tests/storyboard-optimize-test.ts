/**
 * 測試：AI 優化分鏡腳本
 * 用 Gemini 3.1 Pro 對初版分鏡腳本進行專業化潤色
 * 重點：鏡頭語言、情緒張力、場景描寫更生動
 */
import { invokeLLMPro } from "../server/_core/llm";

// 模擬一份初版分鏡腳本（之前 Gemini Flash 生成的《晴天》）
const originalStoryboard = {
  title: "小黄花与雨天",
  musicInfo: {
    bpm: 85,
    emotion: "怀旧、忧郁、失落、希望",
    style: "流行、民谣",
    key: "A小调"
  },
  scenes: [
    {
      sceneNumber: 1,
      timestamp: "00:00-00:30",
      duration: "30秒",
      description: "黄昏时分的乡间小路旁，一片金色的小黄花在微风中轻轻摇曳。远处，一个旧秋千在夕阳下静静地荡着，仿佛还留着童年的笑声。",
      cameraMovement: "推镜（Dolly In），从小黄花特写缓缓推进到秋千全景",
      mood: "怀旧、温暖",
      visualElements: [
        "光影设计：金色时光逆光",
        "色彩分级：暖色调橙黄色",
        "景深效果：浅景深背景虚化",
        "粒子效果：漂浮的花粉和光斑",
        "构图：三分法，前景小黄花"
      ],
      transition: "交叉溶解过渡到下一场景"
    },
    {
      sceneNumber: 2,
      timestamp: "00:30-01:00",
      duration: "30秒",
      description: "少年坐在教室窗边，手托着腮望着窗外发呆。阳光从窗户照进来，在他脸上留下斑驳的光影。桌上摊开的课本被风翻动。",
      cameraMovement: "斯坦尼康跟拍，从走廊缓缓移入教室，最终定格在少年侧脸特写",
      mood: "忧郁、思念",
      visualElements: [
        "光影设计：侧光，窗户光线",
        "色彩分级：淡蓝色冷色调",
        "特效：空气中漂浮的灰尘",
        "构图：框架构图，窗框作为画框",
        "粒子效果：光束中的微尘"
      ],
      transition: "匹配剪辑：课本翻页 → 日历翻页"
    },
    {
      sceneNumber: 3,
      timestamp: "01:00-01:30",
      duration: "30秒",
      description: "雨天的校门口，少年撑着伞等在那里。少女从教学楼跑出来，没有带伞，跑到少年身边躲在伞下，两人相视而笑。",
      cameraMovement: "手持跟拍少女奔跑，到伞下后切换为固定镜头中景",
      mood: "浪漫、温馨、心动",
      visualElements: [
        "光影设计：阴天柔光",
        "色彩分级：蓝灰色调中点缀暖色",
        "特效：雨滴溅落的慢动作",
        "构图：对称构图，伞作为视觉中心",
        "环境元素：水面倒影"
      ],
      transition: "淡出到白色"
    },
    {
      sceneNumber: 4,
      timestamp: "01:30-02:00",
      duration: "30秒",
      description: "毕业典礼后的走廊，少年和少女从两端走来，在中间擦肩而过。两人都回头看了一眼，目光交汇后又各自转身离开。",
      cameraMovement: "推轨平移，跟随两人从两端走向中间，擦肩时切为升格慢动作",
      mood: "失落、不舍、释然",
      visualElements: [
        "光影设计：走廊尽头的逆光",
        "色彩分级：褪色复古胶片感",
        "特效：升格慢动作",
        "构图：引导线，走廊纵深",
        "环境元素：飘落的毕业帽穗"
      ],
      transition: "硬切到黑场"
    }
  ],
  summary: "整体采用怀旧温暖的色调，通过四个场景展现青春记忆中的美好与遗憾。"
};

const OPTIMIZE_PROMPT = `你是一位获得过金马奖、金鸡奖的顶级视频导演兼编剧。你的任务是对一份已有的分镜脚本进行**深度优化润色**，让每个场景的文字描写达到电影级别的生动感和专业度。

## 优化重点

### 1. 场景描写（description）— 要像小说一样生动
- 加入**感官细节**：不只是视觉，还要有声音、气味、触感、温度
- 加入**微表情和肢体语言**：人物的眼神变化、嘴角弧度、手指动作、呼吸节奏
- 加入**环境互动**：风吹动了什么、光线照在哪里、雨滴落在什么上面
- 用**隐喻和象征**：物件暗示情感，空间暗示心理状态
- 例如：不要写"少年望着窗外"，要写"少年的目光穿过沾着水雾的玻璃，停在操场那棵梧桐树上——去年秋天，她就是在那棵树下第一次叫了他的名字"

### 2. 镜头语言（cameraMovement）— 要有导演思维
- 说明**为什么用这个镜头**：这个运动传达什么情绪？
- 加入**镜头节奏**：快推、缓拉、突然静止的对比
- 加入**焦点变化**：焦点从A转移到B，暗示注意力或情感转移
- 加入**画面呼吸感**：镜头的轻微晃动、呼吸般的推拉
- 例如：不要写"推镜到特写"，要写"镜头像被某种力量牵引一样，不自觉地缓缓推向他的眼睛——那里面有整个夏天的倒影"

### 3. 情绪张力（mood）— 要有层次和矛盾
- 不要单一情绪，要有**情绪的层次和冲突**
- 描述情绪的**变化过程**：从A到B的转变
- 用**具体的身体感受**描述情绪：胸口的闷、喉咙的紧、眼眶的热
- 例如：不要写"忧郁"，要写"那种说不出口的闷，像夏天暴雨前的空气，潮湿、沉重，压在胸口，你知道迟早要下，但就是等不到第一滴"

### 4. 视觉元素（visualElements）— 要有情感意义
- 每个视觉元素要说明它的**情感功能**
- 光影不只是技术参数，要说明它**营造了什么感觉**
- 色彩不只是色调，要说明它**暗示了什么情绪**
- 例如：不要写"浅景深背景虚化"，要写"浅景深将整个世界模糊成一片光斑——就像记忆本身，你越想看清，它就越模糊"

### 5. 转场（transition）— 要有叙事意义
- 转场不只是技术手段，要说明**为什么这样转**
- 转场要暗示**时间、情感或叙事的变化**

## 输出要求
- 保持原有的 JSON 结构不变
- 每个字段都要大幅扩展和深化
- description 至少 150 字
- cameraMovement 至少 80 字
- mood 至少 60 字
- 每个 visualElement 至少 40 字
- transition 至少 40 字
- summary 要升级为完整的导演阐述（至少 200 字）

请输出优化后的完整 JSON。`;

async function main() {
  console.log("=== AI 优化分镜脚本测试 ===\n");
  console.log("原始脚本场景数:", originalStoryboard.scenes.length);
  console.log("开始用 Gemini 3.1 Pro 优化...\n");

  const startTime = Date.now();

  const response = await invokeLLMPro({
    messages: [
      {
        role: "system",
        content: OPTIMIZE_PROMPT
      },
      {
        role: "user",
        content: `请优化以下分镜脚本，让每个场景的描写更加生动、专业、有电影感：\n\n${JSON.stringify(originalStoryboard, null, 2)}`
      }
    ],
    response_format: { type: "json_object" }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`优化完成！耗时: ${elapsed}s\n`);

  const optimized = JSON.parse(response.choices[0].message.content as string);

  // 对比输出
  console.log("========================================");
  console.log("  优化前 vs 优化后 对比");
  console.log("========================================\n");

  for (let i = 0; i < originalStoryboard.scenes.length; i++) {
    const orig = originalStoryboard.scenes[i];
    const opt = optimized.scenes[i];

    console.log(`\n--- 场景 ${i + 1} ---\n`);

    console.log("【场景描写】");
    console.log(`  优化前 (${orig.description.length}字):`);
    console.log(`  ${orig.description}\n`);
    console.log(`  优化后 (${opt.description.length}字):`);
    console.log(`  ${opt.description}\n`);

    console.log("【镜头语言】");
    console.log(`  优化前: ${orig.cameraMovement}`);
    console.log(`  优化后: ${opt.cameraMovement}\n`);

    console.log("【情绪张力】");
    console.log(`  优化前: ${orig.mood}`);
    console.log(`  优化后: ${opt.mood}\n`);

    console.log("【转场】");
    console.log(`  优化前: ${orig.transition}`);
    console.log(`  优化后: ${opt.transition}\n`);
  }

  console.log("\n========================================");
  console.log("  导演阐述（优化后 summary）");
  console.log("========================================\n");
  console.log(optimized.summary);

  // 保存完整的优化结果
  const fs = await import("fs");
  fs.writeFileSync("/home/ubuntu/storyboard-optimized.json", JSON.stringify(optimized, null, 2), "utf-8");
  console.log("\n\n完整优化结果已保存到 /home/ubuntu/storyboard-optimized.json");

  // 字数统计
  console.log("\n========================================");
  console.log("  字数统计对比");
  console.log("========================================\n");
  
  let origTotal = 0, optTotal = 0;
  for (let i = 0; i < originalStoryboard.scenes.length; i++) {
    const origLen = JSON.stringify(originalStoryboard.scenes[i]).length;
    const optLen = JSON.stringify(optimized.scenes[i]).length;
    origTotal += origLen;
    optTotal += optLen;
    console.log(`场景 ${i + 1}: ${origLen} → ${optLen} 字 (${((optLen / origLen - 1) * 100).toFixed(0)}% 增长)`);
  }
  console.log(`\n总计: ${origTotal} → ${optTotal} 字 (${((optTotal / origTotal - 1) * 100).toFixed(0)}% 增长)`);
}

main().catch(console.error);
