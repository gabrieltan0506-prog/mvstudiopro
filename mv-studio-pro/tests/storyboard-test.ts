/**
 * Storyboard Generation Test
 * 
 * Tests the core storyboard generation flow:
 * 1. LLM generates storyboard JSON from lyrics
 * 2. Image generation creates preview images for each scene
 */
import { invokeLLM } from "../server/_core/llm";
import { generateImage } from "../server/_core/imageGeneration";

// Test lyrics - 周杰倫《晴天》片段
const TEST_LYRICS = `
故事的小黄花
从出生那年就飘着
童年的荡秋千
随记忆一直晃到现在

刮风这天 我试过握着你手
但偏偏 雨渐渐 大到我看你不见

还要多久 我才能在你身边
等到放晴的那天 也许我会比较好一点

从前从前 有个人爱你很久
但偏偏 风渐渐 把距离吹得好远
好不容易 又能再多爱一天
但故事的最后 你好像还是说了拜拜
`;

const SCENE_COUNT = 5;

async function testStoryboardGeneration() {
  console.log("=" .repeat(60));
  console.log("Storyboard Generation Test");
  console.log("=" .repeat(60));
  
  // Step 1: Generate storyboard JSON via LLM
  console.log("\n[Step 1] Generating storyboard via LLM...");
  const startLLM = Date.now();
  
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一位专业的视频导演和电影摄影师，拥有丰富的视觉叙事经验。请根据歌词或文本内容，生成一个完整且专业的 视频分镜脚本。

## 音乐分析维度
请从以下维度分析歌曲特性：
1. **BPM（节奏速度）**：根据歌词情绪和节奏推测，范围 60-180
2. **情感基调**：如欢快、忧郁、激昂、温柔、怀旧、希望、悲伤、狂野等
3. **音乐风格**：如流行、摇滚、电子、民谣、R&B、嘻哈、爵士、古典等
4. **调性**：如 C大调、A小调、G大调等（根据情感推测）

## JSON 输出格式
请严格按照以下格式输出：

\`\`\`json
{
  "title": "视频标题",
  "musicInfo": {
    "bpm": 120,
    "emotion": "情感基调",
    "style": "音乐风格",
    "key": "调性"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "timestamp": "00:00-00:15",
      "duration": "15秒",
      "description": "详细的场景描述",
      "cameraMovement": "镜头运动类型和说明",
      "mood": "情绪氛围",
      "visualElements": ["视觉元素1", "视觉元素2", "视觉元素3"],
      "transition": "转场方式"
    }
  ],
  "summary": "整体建议"
}
\`\`\`

请确保生成的分镜脚本专业、详细、具有电影感。`
        },
        {
          role: "user",
          content: `请根据以下歌词内容，生成 ${SCENE_COUNT} 个视频分镜场景：\n\n${TEST_LYRICS}`
        }
      ],
      response_format: { type: "json_object" }
    });

    const llmTime = ((Date.now() - startLLM) / 1000).toFixed(1);
    console.log(`  ✓ LLM response received (${llmTime}s)`);
    
    const content = response.choices[0].message.content as string;
    const storyboardData = JSON.parse(content);
    
    console.log(`\n  Title: ${storyboardData.title}`);
    console.log(`  BPM: ${storyboardData.musicInfo.bpm}`);
    console.log(`  Emotion: ${storyboardData.musicInfo.emotion}`);
    console.log(`  Style: ${storyboardData.musicInfo.style}`);
    console.log(`  Key: ${storyboardData.musicInfo.key}`);
    console.log(`  Scenes: ${storyboardData.scenes.length}`);
    console.log(`  Summary: ${storyboardData.summary.substring(0, 100)}...`);
    
    // Print each scene
    for (const scene of storyboardData.scenes) {
      console.log(`\n  --- Scene ${scene.sceneNumber} [${scene.timestamp}] ---`);
      console.log(`  Duration: ${scene.duration}`);
      console.log(`  Description: ${scene.description.substring(0, 120)}...`);
      console.log(`  Camera: ${scene.cameraMovement.substring(0, 80)}...`);
      console.log(`  Mood: ${scene.mood}`);
      console.log(`  Visual Elements: ${scene.visualElements.length} items`);
      if (scene.transition) console.log(`  Transition: ${scene.transition}`);
    }

    // Step 2: Generate preview images for first 2 scenes (to save cost)
    console.log("\n\n[Step 2] Generating preview images (first 2 scenes)...");
    
    const scenesToImage = storyboardData.scenes.slice(0, 2);
    
    for (const scene of scenesToImage) {
      const imagePrompt = `Photorealistic cinematic MV scene: ${scene.description}. ${scene.visualElements.join(", ")}. ${scene.mood} mood. Ultra-realistic, real human actors, professional cinematography, film photography, high quality, detailed, 16:9 aspect ratio. NOT anime, NOT cartoon, NOT illustration. Real photography only.`;
      
      console.log(`\n  Generating image for Scene ${scene.sceneNumber}...`);
      console.log(`  Prompt: ${imagePrompt.substring(0, 100)}...`);
      
      const startImg = Date.now();
      try {
        const { url } = await generateImage({ prompt: imagePrompt });
        const imgTime = ((Date.now() - startImg) / 1000).toFixed(1);
        console.log(`  ✓ Image generated (${imgTime}s): ${url}`);
      } catch (error: any) {
        const imgTime = ((Date.now() - startImg) / 1000).toFixed(1);
        console.log(`  ✗ Image failed (${imgTime}s): ${error.message}`);
      }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("Test Complete!");
    console.log("=".repeat(60));
    
  } catch (error: any) {
    console.error(`\n  ✗ LLM Error: ${error.message}`);
    if (error.stack) console.error(error.stack);
  }
}

testStoryboardGeneration().catch(console.error);
